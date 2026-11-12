import { and, count, desc, eq } from "drizzle-orm";
import { discoveryAssessments, discoveryInventoryResources, discoveryInventoryRuns, discoveryInventorySettings } from "../drizzle/schema";
import { getDb } from "./db";
import type { DiscoveryAssessment, InventoryResourceRecord, InventoryRun, InventorySettings } from "./discovery";

function json(value: unknown) { return JSON.stringify(value); }

export async function persistDiscoveryAssessment(ownerOpenId: string, assessment: DiscoveryAssessment) {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(discoveryAssessments).values({
      id: assessment.id,
      ownerOpenId,
      connectionId: assessment.connectionId,
      tenantId: assessment.tenantId,
      tenantLabel: assessment.tenantLabel,
      organizationName: assessment.organizationName ?? null,
      status: assessment.status,
      startedAt: new Date(assessment.startedAt),
      completedAt: new Date(assessment.completedAt),
      workloads: json(assessment.workloads),
      permissionErrors: json(assessment.permissionErrors),
      permissionChecklist: json(assessment.permissionChecklist),
      inventoryId: assessment.inventory?.id ?? null,
    }).onDuplicateKeyUpdate({ set: {
      connectionId: assessment.connectionId,
      tenantId: assessment.tenantId,
      tenantLabel: assessment.tenantLabel,
      organizationName: assessment.organizationName ?? null,
      status: assessment.status,
      startedAt: new Date(assessment.startedAt),
      completedAt: new Date(assessment.completedAt),
      workloads: json(assessment.workloads),
      permissionErrors: json(assessment.permissionErrors),
      permissionChecklist: json(assessment.permissionChecklist),
      inventoryId: assessment.inventory?.id ?? null,
    } });
    return true;
  } catch (error) {
    console.warn("[DiscoveryPersistence] Could not persist assessment:", error);
    return false;
  }
}

export async function persistInventoryRun(ownerOpenId: string, run: InventoryRun) {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(discoveryInventoryRuns).values({
      id: run.id,
      ownerOpenId,
      assessmentId: run.assessmentId,
      connectionId: run.connectionId,
      status: run.status,
      progress: run.progress,
      itemsTotal: run.itemsTotal,
      itemsDone: run.itemsDone,
      totalSizeBytes: Math.max(0, Math.round(run.totalSizeBytes)),
      workloadResults: json(run.workloadResults),
      error: run.error ?? null,
      startedAt: new Date(run.startedAt),
      completedAt: run.completedAt ? new Date(run.completedAt) : null,
    }).onDuplicateKeyUpdate({ set: {
      assessmentId: run.assessmentId,
      connectionId: run.connectionId,
      status: run.status,
      progress: run.progress,
      itemsTotal: run.itemsTotal,
      itemsDone: run.itemsDone,
      totalSizeBytes: Math.max(0, Math.round(run.totalSizeBytes)),
      workloadResults: json(run.workloadResults),
      error: run.error ?? null,
      startedAt: new Date(run.startedAt),
      completedAt: run.completedAt ? new Date(run.completedAt) : null,
    } });
    return true;
  } catch (error) {
    console.warn("[DiscoveryPersistence] Could not persist inventory run:", error);
    return false;
  }
}

const defaultInventorySettings: Omit<InventorySettings, "connectionId"> = { maxConcurrency: 4, requestsPerSecond: 8, maxRetries: 4 };

export async function loadInventorySettings(ownerOpenId: string, connectionId: string): Promise<InventorySettings> {
  const db = await getDb();
  if (!db) return { connectionId, ...defaultInventorySettings };
  try {
    const rows = await db.select().from(discoveryInventorySettings).where(and(eq(discoveryInventorySettings.ownerOpenId, ownerOpenId), eq(discoveryInventorySettings.connectionId, connectionId))).limit(1);
    const row = rows[0];
    return row ? { connectionId, maxConcurrency: row.maxConcurrency, requestsPerSecond: row.requestsPerSecond, maxRetries: row.maxRetries } : { connectionId, ...defaultInventorySettings };
  } catch (error) {
    console.warn("[DiscoveryPersistence] Could not load inventory settings:", error);
    return { connectionId, ...defaultInventorySettings };
  }
}

export async function persistInventorySettings(ownerOpenId: string, settings: InventorySettings) {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(discoveryInventorySettings).values({ connectionId: settings.connectionId, ownerOpenId, maxConcurrency: settings.maxConcurrency, requestsPerSecond: settings.requestsPerSecond, maxRetries: settings.maxRetries }).onDuplicateKeyUpdate({ set: { ownerOpenId, maxConcurrency: settings.maxConcurrency, requestsPerSecond: settings.requestsPerSecond, maxRetries: settings.maxRetries } });
    return true;
  } catch (error) {
    console.warn("[DiscoveryPersistence] Could not persist inventory settings:", error);
    return false;
  }
}

export async function persistInventoryResources(records: InventoryResourceRecord[]) {
  const db = await getDb();
  if (!db || !records.length) return false;
  try {
    for (const record of records) {
      await db.insert(discoveryInventoryResources).values({ id: record.id, ownerOpenId: record.ownerOpenId, runId: record.runId, assessmentId: record.assessmentId, workload: record.workload, resourceId: record.resourceId, displayName: record.displayName ?? null, status: record.status, itemCount: record.itemCount, sizeBytes: record.sizeBytes, detail: record.detail ?? null, metadata: record.metadata ? json(record.metadata) : null }).onDuplicateKeyUpdate({ set: { displayName: record.displayName ?? null, status: record.status, itemCount: record.itemCount, sizeBytes: record.sizeBytes, detail: record.detail ?? null, metadata: record.metadata ? json(record.metadata) : null } });
    }
    return true;
  } catch (error) {
    console.warn("[DiscoveryPersistence] Could not persist inventory resources:", error);
    return false;
  }
}

export async function pageInventoryResources(ownerOpenId: string, runId: string, workload?: string, offset = 0, limit = 50) {
  const db = await getDb();
  if (!db) return { resources: [], total: 0, offset, limit, nextOffset: null };
  const filters = [eq(discoveryInventoryResources.ownerOpenId, ownerOpenId), eq(discoveryInventoryResources.runId, runId)];
  if (workload) filters.push(eq(discoveryInventoryResources.workload, workload));
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const [rows, totalRows] = await Promise.all([
    db.select().from(discoveryInventoryResources).where(and(...filters)).orderBy(desc(discoveryInventoryResources.sizeBytes)).limit(safeLimit).offset(safeOffset),
    db.select({ value: count() }).from(discoveryInventoryResources).where(and(...filters)),
  ]);
  const total = Number(totalRows[0]?.value ?? 0);
  return { resources: rows.map((row) => ({ ...row, sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes), metadata: row.metadata ? parseJson<Record<string, unknown>>(row.metadata, {}) : undefined })), total, offset: safeOffset, limit: safeLimit, nextOffset: safeOffset + rows.length < total ? safeOffset + rows.length : null };
}

export async function listInventoryResources(ownerOpenId: string, runId: string, workload?: string) {
  return (await pageInventoryResources(ownerOpenId, runId, workload, 0, 200)).resources;
}

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function loadLatestDiscovery(ownerOpenId: string): Promise<{ assessment: DiscoveryAssessment; inventory?: InventoryRun } | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const rows = await db.select().from(discoveryAssessments).where(eq(discoveryAssessments.ownerOpenId, ownerOpenId)).orderBy(desc(discoveryAssessments.updatedAt)).limit(1);
    const row = rows[0];
    if (!row) return null;
    const assessment: DiscoveryAssessment = {
      id: row.id,
      connectionId: row.connectionId,
      tenantId: row.tenantId,
      tenantLabel: row.tenantLabel,
      organizationName: row.organizationName ?? undefined,
      status: row.status,
      startedAt: new Date(row.startedAt).toISOString(),
      completedAt: new Date(row.completedAt).toISOString(),
      workloads: parseJson(row.workloads, []),
      permissionErrors: parseJson(row.permissionErrors, []),
      permissionChecklist: parseJson(row.permissionChecklist, []),
    };
    let inventory: InventoryRun | undefined;
    if (row.inventoryId) {
      const inventoryRows = await db.select().from(discoveryInventoryRuns).where(eq(discoveryInventoryRuns.id, row.inventoryId)).limit(1);
      const inventoryRow = inventoryRows[0];
      if (inventoryRow && inventoryRow.ownerOpenId === ownerOpenId) {
        inventory = {
          id: inventoryRow.id,
          assessmentId: inventoryRow.assessmentId,
          connectionId: inventoryRow.connectionId,
          status: inventoryRow.status,
          progress: inventoryRow.progress,
          startedAt: new Date(inventoryRow.startedAt).toISOString(),
          completedAt: inventoryRow.completedAt ? new Date(inventoryRow.completedAt).toISOString() : undefined,
          itemsTotal: inventoryRow.itemsTotal,
          itemsDone: inventoryRow.itemsDone,
          totalSizeBytes: Number(inventoryRow.totalSizeBytes ?? 0),
          workloadResults: parseJson(inventoryRow.workloadResults, []),
          error: inventoryRow.error ?? undefined,
        };
        assessment.inventory = inventory;
      }
    }
    return { assessment, inventory };
  } catch (error) {
    console.warn("[DiscoveryPersistence] Could not load assessment:", error);
    return null;
  }
}
