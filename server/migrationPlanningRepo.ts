import { and, asc, desc, eq } from "drizzle-orm";
import { migrationProjects, migrationRunbookSteps, migrationRunbooks, migrationWaveDependencies, migrationWavePopulations, migrationWaves, type InsertMigrationProject, type InsertMigrationRunbook, type InsertMigrationRunbookStep, type InsertMigrationWave } from "../drizzle/schema";
import { getDb } from "./db";

type FallbackProject = InsertMigrationProject & { createdAt: Date; updatedAt: Date };
type FallbackWave = InsertMigrationWave & { createdAt: Date; updatedAt: Date };
type FallbackRunbook = InsertMigrationRunbook & { createdAt: Date; updatedAt: Date };
type FallbackStep = InsertMigrationRunbookStep & { id: number; createdAt: Date; updatedAt: Date; completedAt?: Date | null };
const fallbackProjects = new Map<string, FallbackProject>();
const fallbackWaves = new Map<string, FallbackWave>();
const fallbackDependencies: Array<{ id: number; waveId: string; dependsOnWaveId: string; dependencyType: "Completion" | "Approval" | "Mapping" }> = [];
const fallbackRunbooks = new Map<string, FallbackRunbook>();
const fallbackRunbookSteps = new Map<number, FallbackStep>();

export async function listMigrationProjects(ownerOpenId: string) {
  const db = await getDb();
  if (!db) return Array.from(fallbackProjects.values()).filter((project) => project.ownerOpenId === ownerOpenId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return db.select().from(migrationProjects).where(eq(migrationProjects.ownerOpenId, ownerOpenId)).orderBy(desc(migrationProjects.updatedAt));
}
export async function getMigrationProject(id: string, ownerOpenId: string) {
  const db = await getDb();
  if (!db) { const project = fallbackProjects.get(id); return project?.ownerOpenId === ownerOpenId ? project : undefined; }
  const rows = await db.select().from(migrationProjects).where(and(eq(migrationProjects.id, id), eq(migrationProjects.ownerOpenId, ownerOpenId))).limit(1); return rows[0];
}
export async function createMigrationProject(input: InsertMigrationProject) {
  const db = await getDb(); const now = new Date();
  if (!db) { const project: FallbackProject = { ...input, description: input.description ?? null, sourceConnectionId: input.sourceConnectionId ?? null, targetConnectionId: input.targetConnectionId ?? null, phase: input.phase ?? "Assessment", status: input.status ?? "Draft", readinessScore: input.readinessScore ?? 0, createdAt: now, updatedAt: now }; fallbackProjects.set(input.id!, project); return project; }
  await db.insert(migrationProjects).values(input); return getMigrationProject(input.id!, input.ownerOpenId!);
}
export async function updateMigrationProject(id: string, ownerOpenId: string, patch: Partial<InsertMigrationProject>) {
  const db = await getDb();
  if (!db) { const project = await getMigrationProject(id, ownerOpenId); if (!project) return undefined; const updated = { ...project, ...patch, updatedAt: new Date() } as FallbackProject; fallbackProjects.set(id, updated); return updated; }
  await db.update(migrationProjects).set({ ...patch, updatedAt: new Date() }).where(and(eq(migrationProjects.id, id), eq(migrationProjects.ownerOpenId, ownerOpenId))); return getMigrationProject(id, ownerOpenId);
}
export async function listMigrationWaves(projectId: string, ownerOpenId: string) {
  const db = await getDb();
  if (!db) return Array.from(fallbackWaves.values()).filter((wave) => wave.projectId === projectId && wave.ownerOpenId === ownerOpenId).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return db.select({ wave: migrationWaves }).from(migrationWaves).where(and(eq(migrationWaves.projectId, projectId), eq(migrationWaves.ownerOpenId, ownerOpenId))).orderBy(asc(migrationWaves.sequence), desc(migrationWaves.updatedAt)).then((rows) => rows.map((row) => row.wave));
}
export async function getMigrationWave(id: string, ownerOpenId: string) {
  const db = await getDb(); if (!db) { const wave = fallbackWaves.get(id); return wave?.ownerOpenId === ownerOpenId ? wave : undefined; }
  const rows = await db.select().from(migrationWaves).where(and(eq(migrationWaves.id, id), eq(migrationWaves.ownerOpenId, ownerOpenId))).limit(1); return rows[0];
}
export async function createMigrationWave(input: InsertMigrationWave) {
  const db = await getDb(); const now = new Date();
  if (!db) { const wave: FallbackWave = { ...input, sequence: input.sequence ?? 1, phase: input.phase ?? "Planning", status: input.status ?? "Planned", runMode: input.runMode ?? "Full", itemsTotal: input.itemsTotal ?? 0, itemsDone: input.itemsDone ?? 0, progress: input.progress ?? 0, concurrency: input.concurrency ?? "Balanced", validationPolicy: input.validationPolicy ?? "Standard", approvalState: input.approvalState ?? "Pending", scheduledAt: input.scheduledAt ?? null, changeFreezeAt: input.changeFreezeAt ?? null, createdAt: now, updatedAt: now }; fallbackWaves.set(input.id!, wave); return wave; }
  await db.insert(migrationWaves).values(input); return getMigrationWave(input.id!, input.ownerOpenId!);
}
export async function updateMigrationWave(id: string, ownerOpenId: string, patch: Partial<InsertMigrationWave>) {
  const db = await getDb();
  if (!db) { const wave = await getMigrationWave(id, ownerOpenId); if (!wave) return undefined; const updated = { ...wave, ...patch, updatedAt: new Date() } as FallbackWave; fallbackWaves.set(id, updated); return updated; }
  await db.update(migrationWaves).set({ ...patch, updatedAt: new Date() }).where(and(eq(migrationWaves.id, id), eq(migrationWaves.ownerOpenId, ownerOpenId))); return getMigrationWave(id, ownerOpenId);
}
export async function addWaveDependency(waveId: string, dependsOnWaveId: string, dependencyType: "Completion" | "Approval" | "Mapping") {
  const db = await getDb(); if (!db) { const item = { id: fallbackDependencies.length + 1, waveId, dependsOnWaveId, dependencyType }; fallbackDependencies.push(item); return item; }
  await db.insert(migrationWaveDependencies).values({ waveId, dependsOnWaveId, dependencyType }); return { waveId, dependsOnWaveId, dependencyType };
}
export async function listWaveDependencies(waveIds: string[], ownerOpenId: string) {
  const db = await getDb();
  if (!db) return fallbackDependencies.filter((item) => waveIds.includes(item.waveId) && waveIds.includes(item.dependsOnWaveId));
  if (!waveIds.length) return [];
  const rows = await db.select({ dependency: migrationWaveDependencies, wave: migrationWaves }).from(migrationWaveDependencies).innerJoin(migrationWaves, eq(migrationWaveDependencies.waveId, migrationWaves.id)).where(and(eq(migrationWaves.ownerOpenId, ownerOpenId)));
  return rows.map((row) => row.dependency).filter((item) => waveIds.includes(item.waveId) && waveIds.includes(item.dependsOnWaveId));
}
export async function listWavePopulations(waveId: string) {
  const db = await getDb(); if (!db) return []; return db.select().from(migrationWavePopulations).where(eq(migrationWavePopulations.waveId, waveId)).orderBy(desc(migrationWavePopulations.updatedAt));
}

const defaultRunbookSteps: Array<Omit<InsertMigrationRunbookStep, "runbookId" | "sequence">> = [
  { category: "Readiness", title: "Confirm wave approval and dependencies", description: "Verify the target wave is approved, all upstream dependencies are complete, and the change window is authorized.", ownerRole: "Migration lead", status: "Pending", requiresEvidence: 1 },
  { category: "Freeze", title: "Announce source change freeze", description: "Notify impacted users, pause source-side changes, and record the communication reference.", ownerRole: "Change manager", status: "Pending", requiresEvidence: 1 },
  { category: "Validation", title: "Run final delta and preflight checks", description: "Execute the final incremental pass, validate identity mappings, and confirm throttling is within budget.", ownerRole: "Migration operator", status: "Pending", requiresEvidence: 1 },
  { category: "Cutover", title: "Switch users to target OneDrive", description: "Complete the cutover communication and enable target access according to the approved sequence.", ownerRole: "Tenant administrator", status: "Pending", requiresEvidence: 1 },
  { category: "Verify", title: "Validate access, permissions, and sampling", description: "Sample migrated content, test sharing links, and record any remediation items before closing the window.", ownerRole: "Validation owner", status: "Pending", requiresEvidence: 1 },
  { category: "Rollback", title: "Hold rollback decision window", description: "Keep the source rollback path available until the agreed observation period completes; document the go/no-go decision.", ownerRole: "Migration lead", status: "Pending", requiresEvidence: 1 },
];

export async function getMigrationRunbook(projectId: string, ownerOpenId: string) {
  const db = await getDb();
  if (!db) { const runbook = Array.from(fallbackRunbooks.values()).find((item) => item.projectId === projectId && item.ownerOpenId === ownerOpenId); return runbook; }
  const rows = await db.select().from(migrationRunbooks).where(and(eq(migrationRunbooks.projectId, projectId), eq(migrationRunbooks.ownerOpenId, ownerOpenId))).orderBy(desc(migrationRunbooks.updatedAt)).limit(1); return rows[0];
}
export async function listRunbookSteps(runbookId: string) {
  const db = await getDb(); if (!db) return Array.from(fallbackRunbookSteps.values()).filter((step) => step.runbookId === runbookId).sort((a, b) => a.sequence - b.sequence);
  return db.select().from(migrationRunbookSteps).where(eq(migrationRunbookSteps.runbookId, runbookId)).orderBy(asc(migrationRunbookSteps.sequence));
}
export async function ensureMigrationRunbook(projectId: string, ownerOpenId: string, targetWaveId?: string) {
  const existing = await getMigrationRunbook(projectId, ownerOpenId); if (existing) return existing;
  const db = await getDb(); const runbookId = `RUN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`; const now = new Date();
  if (!db) { const runbook: FallbackRunbook = { id: runbookId, projectId, ownerOpenId, targetWaveId: targetWaveId ?? null, name: "Cutover runbook", status: "Draft", scheduledAt: null, changeFreezeAt: null, rollbackWindowMinutes: 60, createdAt: now, updatedAt: now }; fallbackRunbooks.set(runbookId, runbook); defaultRunbookSteps.forEach((step, index) => fallbackRunbookSteps.set(index + 1, { ...step, id: index + 1, runbookId, sequence: index + 1, completedAt: null, createdAt: now, updatedAt: now })); return runbook; }
  await db.insert(migrationRunbooks).values({ id: runbookId, projectId, ownerOpenId, targetWaveId: targetWaveId ?? null, name: "Cutover runbook", status: "Draft", rollbackWindowMinutes: 60 });
  await db.insert(migrationRunbookSteps).values(defaultRunbookSteps.map((step, index) => ({ ...step, runbookId, sequence: index + 1 })));
  return getMigrationRunbook(projectId, ownerOpenId);
}
export async function updateRunbookStep(stepId: number, runbookId: string, status: "Pending" | "In progress" | "Completed" | "Blocked" | "Skipped", evidence?: string | null) {
  const db = await getDb(); const completedAt = status === "Completed" ? new Date() : null;
  if (!db) { const step = fallbackRunbookSteps.get(stepId); if (!step || step.runbookId !== runbookId) return undefined; const updated = { ...step, status, evidence: evidence ?? step.evidence ?? null, completedAt, updatedAt: new Date() }; fallbackRunbookSteps.set(stepId, updated); return updated; }
  await db.update(migrationRunbookSteps).set({ status, evidence: evidence ?? null, completedAt, updatedAt: new Date() }).where(and(eq(migrationRunbookSteps.id, stepId), eq(migrationRunbookSteps.runbookId, runbookId))); return db.select().from(migrationRunbookSteps).where(eq(migrationRunbookSteps.id, stepId)).limit(1).then((rows) => rows[0]);
}
export async function updateMigrationRunbook(id: string, ownerOpenId: string, patch: Partial<InsertMigrationRunbook>) {
  const db = await getDb(); if (!db) { const runbook = fallbackRunbooks.get(id); if (!runbook || runbook.ownerOpenId !== ownerOpenId) return undefined; const updated = { ...runbook, ...patch, updatedAt: new Date() } as FallbackRunbook; fallbackRunbooks.set(id, updated); return updated; }
  await db.update(migrationRunbooks).set({ ...patch, updatedAt: new Date() }).where(and(eq(migrationRunbooks.id, id), eq(migrationRunbooks.ownerOpenId, ownerOpenId))); return db.select().from(migrationRunbooks).where(eq(migrationRunbooks.id, id)).limit(1).then((rows) => rows[0]);
}
