import { desc, eq } from "drizzle-orm";
import { discoveryAssessments, discoveryInventoryRuns } from "../drizzle/schema";
import { getDb } from "./db";
import type { DiscoveryAssessment, InventoryRun } from "./discovery";

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
