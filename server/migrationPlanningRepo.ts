import { and, asc, desc, eq } from "drizzle-orm";
import {
  migrationProjects,
  migrationWaveDependencies,
  migrationWavePopulations,
  migrationWaves,
  type InsertMigrationProject,
  type InsertMigrationWave,
} from "../drizzle/schema";
import { getDb } from "./db";

type FallbackProject = InsertMigrationProject & { createdAt: Date; updatedAt: Date };
type FallbackWave = InsertMigrationWave & { createdAt: Date; updatedAt: Date };
const fallbackProjects = new Map<string, FallbackProject>();
const fallbackWaves = new Map<string, FallbackWave>();

export async function listMigrationProjects(ownerOpenId: string) {
  const db = await getDb();
  if (!db) return Array.from(fallbackProjects.values()).filter((project) => project.ownerOpenId === ownerOpenId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return db.select().from(migrationProjects).where(eq(migrationProjects.ownerOpenId, ownerOpenId)).orderBy(desc(migrationProjects.updatedAt));
}

export async function getMigrationProject(id: string, ownerOpenId: string) {
  const db = await getDb();
  if (!db) { const project = fallbackProjects.get(id); return project?.ownerOpenId === ownerOpenId ? project : undefined; }
  const rows = await db.select().from(migrationProjects).where(and(eq(migrationProjects.id, id), eq(migrationProjects.ownerOpenId, ownerOpenId))).limit(1);
  return rows[0];
}

export async function createMigrationProject(input: InsertMigrationProject) {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const project: FallbackProject = { ...input, description: input.description ?? null, sourceConnectionId: input.sourceConnectionId ?? null, targetConnectionId: input.targetConnectionId ?? null, phase: input.phase ?? "Assessment", status: input.status ?? "Draft", readinessScore: input.readinessScore ?? 0, createdAt: now, updatedAt: now };
    fallbackProjects.set(input.id!, project);
    return project;
  }
  await db.insert(migrationProjects).values(input);
  return getMigrationProject(input.id!, input.ownerOpenId!);
}

export async function updateMigrationProject(id: string, ownerOpenId: string, patch: Partial<InsertMigrationProject>) {
  const db = await getDb();
  if (!db) { const project = await getMigrationProject(id, ownerOpenId); if (!project) return undefined; const updated = { ...project, ...patch, updatedAt: new Date() } as FallbackProject; fallbackProjects.set(id, updated); return updated; }
  await db.update(migrationProjects).set({ ...patch, updatedAt: new Date() }).where(and(eq(migrationProjects.id, id), eq(migrationProjects.ownerOpenId, ownerOpenId)));
  return getMigrationProject(id, ownerOpenId);
}

export async function listMigrationWaves(projectId: string, ownerOpenId: string) {
  const db = await getDb();
  if (!db) return Array.from(fallbackWaves.values()).filter((wave) => wave.projectId === projectId && wave.ownerOpenId === ownerOpenId).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return db.select({ wave: migrationWaves }).from(migrationWaves).where(and(eq(migrationWaves.projectId, projectId), eq(migrationWaves.ownerOpenId, ownerOpenId))).orderBy(asc(migrationWaves.sequence), desc(migrationWaves.updatedAt)).then((rows) => rows.map((row) => row.wave));
}

export async function getMigrationWave(id: string, ownerOpenId: string) {
  const db = await getDb();
  if (!db) { const wave = fallbackWaves.get(id); return wave?.ownerOpenId === ownerOpenId ? wave : undefined; }
  const rows = await db.select().from(migrationWaves).where(and(eq(migrationWaves.id, id), eq(migrationWaves.ownerOpenId, ownerOpenId))).limit(1);
  return rows[0];
}

export async function createMigrationWave(input: InsertMigrationWave) {
  const db = await getDb();
  const now = new Date();
  if (!db) {
    const wave: FallbackWave = { ...input, sequence: input.sequence ?? 1, phase: input.phase ?? "Planning", status: input.status ?? "Planned", runMode: input.runMode ?? "Full", itemsTotal: input.itemsTotal ?? 0, itemsDone: input.itemsDone ?? 0, progress: input.progress ?? 0, concurrency: input.concurrency ?? "Balanced", validationPolicy: input.validationPolicy ?? "Standard", approvalState: input.approvalState ?? "Pending", scheduledAt: input.scheduledAt ?? null, changeFreezeAt: input.changeFreezeAt ?? null, createdAt: now, updatedAt: now };
    fallbackWaves.set(input.id!, wave);
    return wave;
  }
  await db.insert(migrationWaves).values(input);
  return getMigrationWave(input.id!, input.ownerOpenId!);
}

export async function updateMigrationWave(id: string, ownerOpenId: string, patch: Partial<InsertMigrationWave>) {
  const db = await getDb();
  if (!db) { const wave = await getMigrationWave(id, ownerOpenId); if (!wave) return undefined; const updated = { ...wave, ...patch, updatedAt: new Date() } as FallbackWave; fallbackWaves.set(id, updated); return updated; }
  await db.update(migrationWaves).set({ ...patch, updatedAt: new Date() }).where(and(eq(migrationWaves.id, id), eq(migrationWaves.ownerOpenId, ownerOpenId)));
  return getMigrationWave(id, ownerOpenId);
}

export async function addWaveDependency(waveId: string, dependsOnWaveId: string, dependencyType: "Completion" | "Approval" | "Mapping") {
  const db = await getDb();
  if (!db) return { waveId, dependsOnWaveId, dependencyType };
  await db.insert(migrationWaveDependencies).values({ waveId, dependsOnWaveId, dependencyType });
  return { waveId, dependsOnWaveId, dependencyType };
}

export async function listWavePopulations(waveId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(migrationWavePopulations).where(eq(migrationWavePopulations.waveId, waveId)).orderBy(desc(migrationWavePopulations.updatedAt));
}
