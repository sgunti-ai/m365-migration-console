import { getTenantConnection } from "./localAuth";
import { getAppAccessTokenForConnection } from "./graph";
import { inspectGraphPermissions, requiredGraphPermissions, type TenantWorkload } from "./tenantPermissionRules";

export type DiscoveryWorkload = "oneDrive" | "sharePoint" | "exchange" | "teams";

type GraphError = Error & { status?: number };

type InventoryRunStatus = "queued" | "running" | "completed" | "blocked" | "failed" | "unavailable";

export type PermissionChecklistItem = {
  workload: DiscoveryWorkload;
  label: string;
  permission: string;
  title: string;
  reason: string;
  steps: string[];
  adminConsentUrl: string;
  apiPermissionsUrl: string;
};

export type DiscoveryWorkloadResult = {
  workload: DiscoveryWorkload;
  label: string;
  status: "discovered" | "permission_required" | "unavailable";
  itemCount: number;
  sizeBytes: number | null;
  sizeLabel: string;
  detail: string;
  permission?: string;
};

export type InventoryRun = {
  id: string;
  assessmentId: string;
  connectionId: string;
  status: InventoryRunStatus;
  progress: number;
  startedAt: string;
  completedAt?: string;
  itemsTotal: number;
  itemsDone: number;
  totalSizeBytes: number;
  workloadResults: DiscoveryWorkloadResult[];
  error?: string;
};

export type DiscoveryAssessment = {
  id: string;
  connectionId: string;
  tenantId: string;
  tenantLabel: string;
  organizationName?: string;
  status: "completed" | "blocked" | "failed";
  startedAt: string;
  completedAt: string;
  workloads: DiscoveryWorkloadResult[];
  permissionErrors: string[];
  permissionChecklist: PermissionChecklistItem[];
  inventory?: InventoryRun;
};

const assessments = new Map<string, DiscoveryAssessment>();
const inventoryRuns = new Map<string, InventoryRun>();
const labels: Record<DiscoveryWorkload, string> = { oneDrive: "OneDrive", sharePoint: "SharePoint", exchange: "Exchange Online", teams: "Teams" };
const graphPermissionPortal = "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/ApiPermissions";

async function graphGet<T>(token: string, path: string, headers: Record<string, string> = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `https://graph.microsoft.com/v1.0${path}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`Graph ${response.status}: ${detail.slice(0, 300)}`) as GraphError;
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

async function graphGetAll<T>(token: string, path: string, headers: Record<string, string> = {}) {
  const results: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: { value?: T[]; "@odata.nextLink"?: string } = await graphGet<{ value?: T[]; "@odata.nextLink"?: string }>(token, next, headers);
    results.push(...(page.value ?? []));
    next = page["@odata.nextLink"];
  }
  return results;
}

async function graphText(token: string, path: string): Promise<string> {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`Graph ${response.status}: ${detail.slice(0, 300)}`) as GraphError;
    error.status = response.status;
    throw error;
  }
  return response.text();
}

function pageCount(value: unknown) { return Array.isArray(value) ? value.length : 0; }
function resourceCount(result: { "@odata.count"?: number; value?: unknown[] }) { return typeof result["@odata.count"] === "number" ? result["@odata.count"] : pageCount(result.value); }
function permissionList(token: string, workload: DiscoveryWorkload, direction: "source" | "target") { return inspectGraphPermissions(token, workload, direction).missingPermissions; }
function consentUrl(tenantId: string, clientId?: string | null) { return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/adminconsent${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ""}`; }

function buildPermissionChecklist(connection: { tenantId: string; clientId?: string | null }, token: string, workloads: DiscoveryWorkload[]): PermissionChecklistItem[] {
  return workloads.flatMap((workload) => permissionList(token, workload, "source").map((permission) => ({
    workload,
    label: labels[workload],
    permission,
    title: `Grant ${permission} for ${labels[workload]}`,
    reason: workload === "exchange" && permission === "Reports.Read.All" ? "Mailbox storage totals are read from the Microsoft Graph usage report." : `This application permission allows the assessment to inventory ${labels[workload]} resources and calculate data size.`,
    steps: ["Open Microsoft Entra admin center and select the migration app registration.", `Add Microsoft Graph → Application permission → ${permission}.`, "Select Grant admin consent for the tenant, then rerun the connection test and inventory."],
    adminConsentUrl: consentUrl(connection.tenantId, connection.clientId),
    apiPermissionsUrl: graphPermissionPortal,
  })));
}

async function workloadResult(token: string, workload: DiscoveryWorkload, direction: "source" | "target"): Promise<DiscoveryWorkloadResult> {
  const label = labels[workload];
  try {
    if (workload === "oneDrive") {
      const users = await graphGet<{ "@odata.count"?: number; value?: Array<{ id?: string }> }>(token, "/users?$select=id&$top=1&$count=true", { ConsistencyLevel: "eventual" });
      return { workload, label, status: "discovered", itemCount: resourceCount(users), sizeBytes: null, sizeLabel: "Pending drive inventory", detail: "OneDrive-capable source identities discovered. A background inventory will aggregate drive quota usage and file totals." };
    }
    if (workload === "sharePoint") {
      const sites = await graphGet<{ "@odata.count"?: number; value?: Array<{ id?: string }> }>(token, "/sites?search=*&$select=id&$top=1&$count=true", { ConsistencyLevel: "eventual" });
      return { workload, label, status: "discovered", itemCount: resourceCount(sites), sizeBytes: null, sizeLabel: "Pending site inventory", detail: "Accessible SharePoint sites discovered. A background inventory will aggregate site drive quota usage." };
    }
    if (workload === "exchange") {
      const users = await graphGet<{ "@odata.count"?: number; value?: Array<{ id?: string }> }>(token, "/users?$select=id&$top=1&$count=true", { ConsistencyLevel: "eventual" });
      return { workload, label, status: "discovered", itemCount: resourceCount(users), sizeBytes: null, sizeLabel: "Pending mailbox inventory", detail: "Mailbox-capable identities discovered. A background inventory will read the Microsoft Graph mailbox usage report." };
    }
    const teams = await graphGet<{ "@odata.count"?: number; value?: Array<{ id?: string }> }>(token, "/teams?$select=id&$top=1&$count=true", { ConsistencyLevel: "eventual" });
    return { workload, label, status: "discovered", itemCount: resourceCount(teams), sizeBytes: null, sizeLabel: "Pending team inventory", detail: `Teams discovered for the ${direction} tenant. A background inventory will aggregate team files and channel counts.` };
  } catch (error) {
    const status = (error as GraphError).status;
    const permission = status === 403 ? requiredGraphPermissions(workload, direction)[0] : undefined;
    return { workload, label, status: permission ? "permission_required" : "unavailable", itemCount: 0, sizeBytes: null, sizeLabel: "Unavailable", permission, detail: permission ? `Permission required: ${permission}. Grant admin consent, then rerun discovery.` : error instanceof Error ? error.message : "Workload discovery failed." };
  }
}

async function sumDriveQuotas(token: string, ids: string[], pathFor: (id: string) => string) {
  let sizeBytes = 0;
  let processed = 0;
  for (const id of ids) {
    try {
      const drive = await graphGet<{ quota?: { used?: number } }>(token, pathFor(id));
      sizeBytes += Number(drive.quota?.used ?? 0);
    } finally { processed += 1; }
  }
  return { sizeBytes, processed };
}

function parseCsvSize(csv: string) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { rows: 0, sizeBytes: 0 };
  const header = lines[0].split(",").map((item) => item.replace(/^"|"$/g, "").toLowerCase());
  const storageIndex = header.findIndex((item) => /storage.*(used|bytes)|used.*storage/.test(item));
  const rows = lines.slice(1).filter((line) => line.trim()).map((line) => line.split(",")).filter((row) => row.length > 1);
  const sizeBytes = storageIndex < 0 ? 0 : rows.reduce((sum, row) => sum + Number(String(row[storageIndex] ?? "0").replaceAll('"', "").replaceAll(",", "")) || 0, 0);
  return { rows: rows.length, sizeBytes };
}

async function detailedWorkloadResult(token: string, workload: DiscoveryWorkload): Promise<DiscoveryWorkloadResult> {
  try {
    if (workload === "oneDrive") {
      const users = await graphGetAll<{ id?: string }>(token, "/users?$select=id&$top=999");
      const ids = users.map((item) => item.id).filter((id): id is string => Boolean(id));
      const result = await sumDriveQuotas(token, ids, (id) => `/users/${encodeURIComponent(id)}/drive?$select=quota`);
      return { workload, label: labels[workload], status: "discovered", itemCount: ids.length, sizeBytes: result.sizeBytes, sizeLabel: formatBytes(result.sizeBytes), detail: `${result.processed.toLocaleString()} personal drives inventoried from Microsoft Graph quota usage.` };
    }
    if (workload === "sharePoint") {
      const sites = await graphGetAll<{ id?: string }>(token, "/sites?search=*&$select=id&$top=999");
      const ids = sites.map((item) => item.id).filter((id): id is string => Boolean(id));
      const result = await sumDriveQuotas(token, ids, (id) => `/sites/${encodeURIComponent(id)}/drive?$select=quota`);
      return { workload, label: labels[workload], status: "discovered", itemCount: ids.length, sizeBytes: result.sizeBytes, sizeLabel: formatBytes(result.sizeBytes), detail: `${result.processed.toLocaleString()} SharePoint site drives inventoried from Microsoft Graph quota usage.` };
    }
    if (workload === "exchange") {
      const report = parseCsvSize(await graphText(token, "/reports/getMailboxUsageDetail(period='D7')"));
      return { workload, label: labels[workload], status: "discovered", itemCount: report.rows, sizeBytes: report.sizeBytes, sizeLabel: report.sizeBytes ? formatBytes(report.sizeBytes) : "No usage reported", detail: `${report.rows.toLocaleString()} mailboxes included in the latest Microsoft Graph 7-day usage report.` };
    }
    const teams = await graphGetAll<{ id?: string }>(token, "/teams?$select=id&$top=999");
    const teamIds = teams.map((item) => item.id).filter((id): id is string => Boolean(id));
    const result = await sumDriveQuotas(token, teamIds, (id) => `/groups/${encodeURIComponent(id)}/drive?$select=quota`);
    return { workload, label: labels[workload], status: "discovered", itemCount: teamIds.length, sizeBytes: result.sizeBytes, sizeLabel: formatBytes(result.sizeBytes), detail: `${result.processed.toLocaleString()} team file drives inventoried, including channel files stored in SharePoint.` };
  } catch (error) {
    const status = (error as GraphError).status;
    const permission = status === 403 ? requiredGraphPermissions(workload, "source").find((item) => item === "Reports.Read.All" || item.startsWith("Files.")) ?? requiredGraphPermissions(workload, "source")[0] : undefined;
    return { workload, label: labels[workload], status: permission ? "permission_required" : "unavailable", itemCount: 0, sizeBytes: null, sizeLabel: "Unavailable", permission, detail: permission ? `Background inventory requires ${permission}. Grant admin consent and retry this inventory.` : error instanceof Error ? error.message : "Detailed inventory failed." };
  }
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export async function testSourceDiscoveryConnection(ownerOpenId: string, connectionId: string) {
  const connection = await getTenantConnection(ownerOpenId, connectionId);
  if (!connection) return { ok: false as const, status: "error" as const, detail: "Source tenant connection was not found." };
  if (connection.direction !== "source") return { ok: false as const, status: "error" as const, detail: "Discovery can only run against a source tenant connection." };
  const token = await getAppAccessTokenForConnection(connection);
  if (!token) return { ok: false as const, status: "not_configured" as const, detail: "Source tenant credentials are incomplete." };
  try {
    const organization = await graphGet<{ value?: Array<{ displayName?: string }> }>(token, "/organization?$select=displayName");
    const workloads = Object.keys(labels) as DiscoveryWorkload[];
    const permissions = Object.fromEntries(workloads.map((workload) => [workload, inspectGraphPermissions(token, workload, "source")]));
    const checklist = buildPermissionChecklist(connection, token, workloads);
    if (checklist.length) return { ok: false as const, status: "error" as const, displayName: organization.value?.[0]?.displayName, permissions, permissionChecklist: checklist, detail: `Source connection is reachable, but discovery permissions are incomplete: ${checklist.map((item) => `${item.label}: ${item.permission}`).join(", ")}. Grant admin consent and test again.` };
    return { ok: true as const, status: "connected" as const, displayName: organization.value?.[0]?.displayName, permissions, permissionChecklist: [] as PermissionChecklistItem[] };
  } catch (error) {
    return { ok: false as const, status: "error" as const, detail: error instanceof Error ? error.message : "Source tenant connection failed." };
  }
}

export async function runSourceDiscovery(ownerOpenId: string, connectionId: string): Promise<DiscoveryAssessment> {
  const connection = await getTenantConnection(ownerOpenId, connectionId);
  if (!connection || connection.direction !== "source") throw new Error("Select a saved source tenant connection before starting discovery.");
  const token = await getAppAccessTokenForConnection(connection);
  if (!token) throw new Error("Source tenant credentials are incomplete. Add and validate the encrypted client secret first.");
  const startedAt = new Date().toISOString();
  const organization = await graphGet<{ value?: Array<{ displayName?: string }> }>(token, "/organization?$select=displayName");
  const workloads = Object.keys(labels) as DiscoveryWorkload[];
  const results = await Promise.all(workloads.map((workload) => workloadResult(token, workload, "source")));
  const permissionChecklist = buildPermissionChecklist(connection, token, workloads);
  const permissionErrors = permissionChecklist.map((item) => `${item.label}: ${item.permission} is required`);
  const assessment: DiscoveryAssessment = { id: `DISC-${Date.now().toString(36)}`, connectionId, tenantId: connection.tenantId, tenantLabel: connection.label, organizationName: organization.value?.[0]?.displayName, status: permissionErrors.length === workloads.length ? "blocked" : "completed", startedAt, completedAt: new Date().toISOString(), workloads: results, permissionErrors, permissionChecklist };
  assessments.set(ownerOpenId, assessment);
  const { persistDiscoveryAssessment } = await import("./discoveryPersistence");
  await persistDiscoveryAssessment(ownerOpenId, assessment);
  return assessment;
}

export async function createInventoryRun(ownerOpenId: string, assessmentId: string, connectionId?: string): Promise<InventoryRun> {
  const assessment = assessments.get(ownerOpenId);
  const run: InventoryRun = { id: `INV-${Date.now().toString(36)}`, assessmentId, connectionId: connectionId ?? assessment?.connectionId ?? "", status: "queued", progress: 0, startedAt: new Date().toISOString(), itemsTotal: 4, itemsDone: 0, totalSizeBytes: 0, workloadResults: [] };
  inventoryRuns.set(ownerOpenId, run);
  if (assessment?.id === assessmentId) assessment.inventory = run;
  const { persistInventoryRun, persistDiscoveryAssessment } = await import("./discoveryPersistence");
  await persistInventoryRun(ownerOpenId, run);
  if (assessment?.id === assessmentId) await persistDiscoveryAssessment(ownerOpenId, assessment);
  return run;
}

export async function latestInventory(ownerOpenId: string) {
  const memory = inventoryRuns.get(ownerOpenId);
  if (memory) return memory;
  const { loadLatestDiscovery } = await import("./discoveryPersistence");
  const loaded = await loadLatestDiscovery(ownerOpenId);
  if (loaded?.inventory) inventoryRuns.set(ownerOpenId, loaded.inventory);
  if (loaded?.assessment) assessments.set(ownerOpenId, loaded.assessment);
  return loaded?.inventory ?? null;
}

export async function runDetailedWorkloadInventory(ownerOpenId: string, connectionId: string, assessmentId: string) {
  let run = inventoryRuns.get(ownerOpenId);
  let assessment = assessments.get(ownerOpenId);
  if (!run || !assessment) {
    const { loadLatestDiscovery } = await import("./discoveryPersistence");
    const loaded = await loadLatestDiscovery(ownerOpenId);
    if (loaded?.assessment) { assessment = loaded.assessment; assessments.set(ownerOpenId, assessment); }
    if (loaded?.inventory) { run = loaded.inventory; inventoryRuns.set(ownerOpenId, run); }
  }
  if (!run || !assessment || run.assessmentId !== assessmentId) throw new Error("Discovery assessment is no longer available. Run a new scan first.");
  const connection = await getTenantConnection(ownerOpenId, connectionId);
  if (!connection || connection.direction !== "source") throw new Error("Source tenant connection was not found.");
  const token = await getAppAccessTokenForConnection(connection);
  if (!token) throw new Error("Source tenant credentials are incomplete.");
  run.status = "running";
  const { persistInventoryRun, persistDiscoveryAssessment } = await import("./discoveryPersistence");
  await persistInventoryRun(ownerOpenId, run);
  const workloads = Object.keys(labels) as DiscoveryWorkload[];
  try {
    for (const workload of workloads) {
      const result = await detailedWorkloadResult(token, workload);
      run.workloadResults = [...run.workloadResults.filter((item) => item.workload !== workload), result];
      run.itemsDone += 1;
      run.progress = Math.round((run.itemsDone / run.itemsTotal) * 100);
      run.totalSizeBytes = run.workloadResults.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
      assessment.workloads = assessment.workloads.map((item) => item.workload === workload ? result : item);
      await persistInventoryRun(ownerOpenId, run);
      await persistDiscoveryAssessment(ownerOpenId, assessment);
      if (result.status === "permission_required") {
        assessment.permissionErrors = Array.from(new Set([...assessment.permissionErrors, `${result.label}: ${result.permission} is required`]));
        assessment.permissionChecklist = buildPermissionChecklist(connection, token, [workload]);
      }
    }
    run.status = run.workloadResults.some((item) => item.status === "permission_required") ? "blocked" : "completed";
    run.completedAt = new Date().toISOString();
    assessment.inventory = run;
    await persistInventoryRun(ownerOpenId, run);
    await persistDiscoveryAssessment(ownerOpenId, assessment);
    return run;
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "Detailed inventory failed.";
    assessment.inventory = run;
    await persistInventoryRun(ownerOpenId, run);
    await persistDiscoveryAssessment(ownerOpenId, assessment);
    throw error;
  }
}

export async function latestDiscovery(ownerOpenId: string) {
  const memory = assessments.get(ownerOpenId);
  if (memory) return memory;
  const { loadLatestDiscovery } = await import("./discoveryPersistence");
  const loaded = await loadLatestDiscovery(ownerOpenId);
  if (loaded?.assessment) assessments.set(ownerOpenId, loaded.assessment);
  if (loaded?.inventory) inventoryRuns.set(ownerOpenId, loaded.inventory);
  return loaded?.assessment ?? null;
}

export function discoveryCsv(assessment: DiscoveryAssessment) {
  const rows = [["Workload", "Status", "Items", "Size", "Detail"], ...assessment.workloads.map((item) => [item.label, item.status, String(item.itemCount), item.sizeBytes === null ? item.sizeLabel : formatBytes(item.sizeBytes), item.detail])];
  return rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
}
