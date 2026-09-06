import { desc, eq } from "drizzle-orm";
import { migrationJobEvents, migrationJobs, type InsertMigrationJob, type MigrationJob } from "../drizzle/schema";
import { getDb } from "./db";
import { broadcastMigrationEvent, type MigrationEvent } from "./realtime";

const fallbackJobs = new Map<string, MigrationJob>();

function toClientJob(job: MigrationJob) {
  return {
    id: job.id,
    name: job.name,
    workload: job.workload,
    owner: job.ownerOpenId,
    status: job.status,
    progress: job.progress,
    items: `${job.itemsDone} / ${job.itemsTotal || 0}`,
    started: job.createdAt.toISOString(),
    throughput: job.throughputGbHr ? `${job.throughputGbHr} GB/hr` : "—",
    errors: job.lastError ? 1 : 0,
    eta: job.eta,
    checkpoint: job.checkpoint ? JSON.parse(job.checkpoint) : null,
    batchMode: Boolean(job.batchMode),
    batchSize: job.batchSize,
    schedule: job.schedule,
    scheduledAt: job.scheduledAt?.toISOString() ?? null,
  };
}

function fallbackJob(input: InsertMigrationJob): MigrationJob {
  const now = new Date();
  return {
    id: input.id!,
    name: input.name!,
    workload: input.workload!,
    scope: input.scope!,
    ownerOpenId: input.ownerOpenId!,
    status: input.status ?? "Queued",
    progress: input.progress ?? 0,
    itemsDone: input.itemsDone ?? 0,
    itemsTotal: input.itemsTotal ?? 0,
    throughputGbHr: input.throughputGbHr ?? 0,
    eta: input.eta ?? "Queued",
    concurrency: input.concurrency ?? "Balanced",
    batchMode: input.batchMode ?? 0,
    batchSize: input.batchSize ?? null,
    schedule: input.schedule ?? null,
    scheduledAt: input.scheduledAt ?? null,
    checkpoint: input.checkpoint ?? null,
    lastError: input.lastError ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listMigrationJobs(ownerOpenId: string) {
  const db = await getDb();
  if (!db) return Array.from(fallbackJobs.values()).filter(job => job.ownerOpenId === ownerOpenId).map(toClientJob);
  const rows = await db.select().from(migrationJobs).where(eq(migrationJobs.ownerOpenId, ownerOpenId)).orderBy(desc(migrationJobs.updatedAt));
  return rows.map(toClientJob);
}

export async function getMigrationJob(id: string) {
  const db = await getDb();
  if (!db) return fallbackJobs.get(id);
  const rows = await db.select().from(migrationJobs).where(eq(migrationJobs.id, id)).limit(1);
  return rows[0];
}

export async function createMigrationJob(input: InsertMigrationJob) {
  const db = await getDb();
  if (!db) {
    const job = fallbackJob(input);
    fallbackJobs.set(job.id, job);
    publish("job.created", job, "Job persisted in the local fallback store; configure DATABASE_URL for durable storage.");
    return toClientJob(job);
  }
  await db.insert(migrationJobs).values(input);
  const job = await getMigrationJob(input.id!);
  if (!job) throw new Error("Created migration job could not be read back");
  publish("job.created", job);
  return toClientJob(job);
}

export async function updateMigrationJob(id: string, patch: Partial<InsertMigrationJob>) {
  const db = await getDb();
  if (!db) {
    const existing = fallbackJobs.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date() } as MigrationJob;
    fallbackJobs.set(id, updated);
    publish(eventForStatus(updated.status), updated);
    return toClientJob(updated);
  }
  await db.update(migrationJobs).set({ ...patch, updatedAt: new Date() }).where(eq(migrationJobs.id, id));
  const job = await getMigrationJob(id);
  if (!job) return undefined;
  publish(eventForStatus(job.status), job);
  return toClientJob(job);
}

export async function appendMigrationEvent(jobId: string, type: string, payload: unknown) {
  const db = await getDb();
  if (!db) return;
  await db.insert(migrationJobEvents).values({ jobId, type, payload: JSON.stringify(payload) });
}

export async function listMigrationEvents(jobId: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(migrationJobEvents).where(eq(migrationJobEvents.jobId, jobId)).orderBy(desc(migrationJobEvents.createdAt)).limit(limit);
  return rows.map(row => ({ ...row, payload: JSON.parse(row.payload) as unknown }));
}

function eventForStatus(status: MigrationJob["status"]): MigrationEvent["type"] {
  if (status === "Paused") return "job.paused";
  if (status === "Running") return "job.resumed";
  if (status === "Completed") return "job.completed";
  if (status === "Failed") return "job.failed";
  if (status === "Cancelled") return "job.cancelled";
  return "job.updated";
}

function publish(type: MigrationEvent["type"], job: MigrationJob, detail?: string) {
  const event: MigrationEvent = { type, jobId: job.id, emittedAt: Date.now(), job: toClientJob(job), detail };
  broadcastMigrationEvent(event);
  void appendMigrationEvent(job.id, type, event);
}
