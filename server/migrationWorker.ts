import { Queue, Worker, type Job } from "bullmq";
import { ENV } from "./_core/env";
import { appendMigrationEvent, getMigrationJob, updateMigrationJob } from "./migrationRepo";
import { getSharePointMigrationProgress } from "./sharepointMigration";

export type SharePointPollJob = { migrationJobId: string };

const queueName = "m365-sharepoint-migration";
let pollQueue: Queue<SharePointPollJob> | null = null;
let worker: Worker<SharePointPollJob> | null = null;

function redisConnection() {
  if (!ENV.redisUrl) return null;
  const url = new URL(ENV.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export function isMigrationQueueConfigured() {
  return Boolean(ENV.redisUrl);
}

export async function enqueueSharePointPolling(migrationJobId: string, delay = 0) {
  if (!pollQueue) return false;
  await pollQueue.add("poll-progress", { migrationJobId }, {
    delay,
    attempts: 6,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 1000,
  });
  return true;
}

async function pollSharePointJob(job: Job<SharePointPollJob>) {
  const record = await getMigrationJob(job.data.migrationJobId);
  if (!record || ["Completed", "Cancelled", "Failed"].includes(record.status)) return { status: record?.status ?? "missing" };
  const checkpoint = record.checkpoint ? JSON.parse(record.checkpoint) as { sharePointJobId?: string; nextToken?: string } : {};
  if (!checkpoint.sharePointJobId) return { status: "waiting-for-submission" };

  const result = await getSharePointMigrationProgress(checkpoint.sharePointJobId, checkpoint.nextToken ?? "0");
  const last = result.events.at(-1);
  const total = Number(last?.TotalExpectedSPObjects ?? record.itemsTotal);
  const done = Number(last?.ObjectsProcessed ?? record.itemsDone);
  const terminal = last?.Event === "JobEnd" || last?.Event === "JobError";
  const nextStatus = last?.Event === "JobEnd" ? "Completed" : last?.Event === "JobError" ? "Failed" : "Running";
  const nextCheckpoint = { ...checkpoint, nextToken: result.nextToken, lastEvent: last?.Event ?? null, polledAt: new Date().toISOString() };
  await updateMigrationJob(record.id, {
    status: nextStatus,
    progress: last?.Event === "JobEnd" ? 100 : total > 0 ? Math.min(99, Math.round((done / total) * 100)) : record.progress,
    itemsDone: done,
    itemsTotal: total,
    checkpoint: JSON.stringify(nextCheckpoint),
    eta: last?.Event === "JobEnd" ? "Complete" : record.eta,
    lastError: last?.Event === "JobError" ? String(last.Message ?? "SharePoint Migration API reported an error") : record.lastError,
  });
  await appendMigrationEvent(record.id, "sharepoint.progress", { events: result.events, nextToken: result.nextToken, workerJobId: job.id });
  if (!terminal) await enqueueSharePointPolling(record.id, 5000);
  return { status: nextStatus, events: result.events.length, nextToken: result.nextToken };
}

export function startMigrationWorker() {
  const connection = redisConnection();
  if (!connection) {
    console.warn("[MigrationWorker] REDIS_URL is not configured; automatic polling is disabled.");
    return null;
  }
  pollQueue = new Queue<SharePointPollJob>(queueName, { connection });
  worker = new Worker<SharePointPollJob>(queueName, pollSharePointJob, { connection, concurrency: 2, limiter: { max: 20, duration: 1000 } });
  worker.on("completed", job => console.log(`[MigrationWorker] completed ${job.id}`));
  worker.on("failed", (job, error) => console.error(`[MigrationWorker] failed ${job?.id ?? "unknown"}:`, error.message));
  console.log(`[MigrationWorker] BullMQ worker started on ${queueName}`);
  return worker;
}

export async function stopMigrationWorker() {
  await worker?.close();
  await pollQueue?.close();
  worker = null;
  pollQueue = null;
}
