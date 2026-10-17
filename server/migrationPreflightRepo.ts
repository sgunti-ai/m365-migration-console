import { and, desc, eq } from "drizzle-orm";
import { migrationJobValidations, migrationRemediationItems, type MigrationJobValidation, type MigrationRemediationItem } from "../drizzle/schema";
import { getDb } from "./db";

const fallbackValidations = new Map<string, MigrationJobValidation>();
const fallbackRemediation = new Map<number, MigrationRemediationItem>();
let fallbackRemediationId = 1;

function parseChecks(checks: string) {
  try { return JSON.parse(checks) as unknown; } catch { return []; }
}

export function toClientValidation(row: MigrationJobValidation) {
  return { ...row, checks: parseChecks(row.checks) };
}

export function toClientRemediation(row: MigrationRemediationItem) {
  return { ...row, retryable: Boolean(row.retryable) };
}

export async function createValidation(input: Omit<MigrationJobValidation, "createdAt">) {
  const db = await getDb();
  if (!db) {
    const now = new Date();
    const row = { ...input, createdAt: now } as MigrationJobValidation;
    fallbackValidations.set(row.id, row);
    return toClientValidation(row);
  }
  await db.insert(migrationJobValidations).values(input);
  const rows = await db.select().from(migrationJobValidations).where(eq(migrationJobValidations.id, input.id)).limit(1);
  if (!rows[0]) throw new Error("Validation run could not be read back");
  return toClientValidation(rows[0]);
}

export async function getLatestValidation(jobId: string, ownerOpenId: string) {
  const db = await getDb();
  if (!db) {
    const rows = Array.from(fallbackValidations.values()).filter((row) => row.jobId === jobId && row.ownerOpenId === ownerOpenId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows[0] ? toClientValidation(rows[0]) : null;
  }
  const rows = await db.select().from(migrationJobValidations).where(and(eq(migrationJobValidations.jobId, jobId), eq(migrationJobValidations.ownerOpenId, ownerOpenId))).orderBy(desc(migrationJobValidations.createdAt)).limit(1);
  return rows[0] ? toClientValidation(rows[0]) : null;
}

export async function createRemediationItems(items: Array<Omit<MigrationRemediationItem, "id" | "createdAt" | "updatedAt">>) {
  if (!items.length) return [];
  const db = await getDb();
  if (!db) {
    const now = new Date();
    return items.map((input) => {
      const row = { ...input, id: fallbackRemediationId++, createdAt: now, updatedAt: now } as MigrationRemediationItem;
      fallbackRemediation.set(row.id, row);
      return toClientRemediation(row);
    });
  }
  await db.insert(migrationRemediationItems).values(items);
  const rows = await db.select().from(migrationRemediationItems).where(eq(migrationRemediationItems.jobId, items[0].jobId)).orderBy(desc(migrationRemediationItems.createdAt));
  return rows.map(toClientRemediation);
}

export async function listRemediationItems(ownerOpenId: string, input?: { jobId?: string; workload?: string; status?: string }) {
  const db = await getDb();
  if (!db) {
    return Array.from(fallbackRemediation.values()).filter((row) => row.ownerOpenId === ownerOpenId && (!input?.jobId || row.jobId === input.jobId) && (!input?.workload || row.workload === input.workload) && (!input?.status || row.status === input.status)).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(toClientRemediation);
  }
  const clauses = [eq(migrationRemediationItems.ownerOpenId, ownerOpenId)];
  if (input?.jobId) clauses.push(eq(migrationRemediationItems.jobId, input.jobId));
  if (input?.workload) clauses.push(eq(migrationRemediationItems.workload, input.workload));
  if (input?.status) clauses.push(eq(migrationRemediationItems.status, input.status as MigrationRemediationItem["status"]));
  const rows = await db.select().from(migrationRemediationItems).where(and(...clauses)).orderBy(desc(migrationRemediationItems.updatedAt));
  return rows.map(toClientRemediation);
}

export async function getRemediationItem(id: number, ownerOpenId: string) {
  const db = await getDb();
  if (!db) {
    const row = fallbackRemediation.get(id);
    return row?.ownerOpenId === ownerOpenId ? row : undefined;
  }
  const rows = await db.select().from(migrationRemediationItems).where(and(eq(migrationRemediationItems.id, id), eq(migrationRemediationItems.ownerOpenId, ownerOpenId))).limit(1);
  return rows[0];
}

export async function updateRemediationItem(id: number, ownerOpenId: string, patch: Partial<MigrationRemediationItem>) {
  const db = await getDb();
  if (!db) {
    const existing = fallbackRemediation.get(id);
    if (!existing || existing.ownerOpenId !== ownerOpenId) return undefined;
    const updated = { ...existing, ...patch, updatedAt: new Date() } as MigrationRemediationItem;
    fallbackRemediation.set(id, updated);
    return toClientRemediation(updated);
  }
  await db.update(migrationRemediationItems).set({ ...patch, updatedAt: new Date() }).where(and(eq(migrationRemediationItems.id, id), eq(migrationRemediationItems.ownerOpenId, ownerOpenId)));
  const updated = await getRemediationItem(id, ownerOpenId);
  return updated ? toClientRemediation(updated) : undefined;
}
