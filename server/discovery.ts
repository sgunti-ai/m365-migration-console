import { getTenantConnection } from "./localAuth";
import { getAppAccessTokenForConnection } from "./graph";
import { inspectGraphPermissions, requiredGraphPermissions, type TenantWorkload } from "./tenantPermissionRules";

export type DiscoveryWorkload = "oneDrive" | "sharePoint" | "exchange" | "teams";

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
};

const assessments = new Map<string, DiscoveryAssessment>();
const labels: Record<DiscoveryWorkload, string> = { oneDrive: "OneDrive", sharePoint: "SharePoint", exchange: "Exchange Online", teams: "Teams" };

async function graphGet<T>(token: string, path: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`Graph ${response.status}: ${detail.slice(0, 300)}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

function pageCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function resourceCount(result: { "@odata.count"?: number; value?: unknown[] }) {
  return typeof result["@odata.count"] === "number" ? result["@odata.count"] : pageCount(result.value);
}

async function workloadResult(token: string, workload: DiscoveryWorkload, direction: "source" | "target"): Promise<DiscoveryWorkloadResult> {
  const label = labels[workload];
  try {
    if (workload === "oneDrive") {
      const users = await graphGet<{ "@odata.count"?: number; value?: Array<{ id?: string }> }>(token, "/users?$select=id&$top=1&$count=true", { ConsistencyLevel: "eventual" });
      return { workload, label, status: "discovered", itemCount: resourceCount(users), sizeBytes: null, sizeLabel: "Pending drive inventory", detail: "OneDrive-capable source identities discovered. Per-drive file and folder sizes are collected during workload inventory." };
    }
    if (workload === "sharePoint") {
      const sites = await graphGet<{ "@odata.count"?: number; value?: Array<{ id?: string }> }>(token, "/sites?search=*&$select=id&$top=1&$count=true", { ConsistencyLevel: "eventual" });
      return { workload, label, status: "discovered", itemCount: resourceCount(sites), sizeBytes: null, sizeLabel: "Pending site inventory", detail: "Accessible SharePoint sites discovered. File and folder sizes are collected during site-level inventory." };
    }
    if (workload === "exchange") {
      const users = await graphGet<{ "@odata.count"?: number; value?: Array<{ id?: string }> }>(token, "/users?$select=id&$top=1&$count=true", { ConsistencyLevel: "eventual" });
      return { workload, label, status: "discovered", itemCount: resourceCount(users), sizeBytes: null, sizeLabel: "Pending mailbox inventory", detail: "Mailbox-capable user identities discovered. Mailbox size and item counts require Exchange workload inventory." };
    }
    const teams = await graphGet<{ "@odata.count"?: number; value?: Array<{ id?: string }> }>(token, "/teams?$select=id&$top=1&$count=true", { ConsistencyLevel: "eventual" });
    return { workload, label, status: "discovered", itemCount: resourceCount(teams), sizeBytes: null, sizeLabel: "Pending channel inventory", detail: `Teams discovered for the ${direction} tenant. Channel, message, and file sizes require team-level inventory.` };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    const permission = status === 403 ? requiredGraphPermissions(workload, direction)[0] : undefined;
    return { workload, label, status: permission ? "permission_required" : "unavailable", itemCount: 0, sizeBytes: null, sizeLabel: "Unavailable", permission, detail: permission ? `Permission required: ${permission}. Grant admin consent, then rerun discovery.` : error instanceof Error ? error.message : "Workload discovery failed." };
  }
}

export async function testSourceDiscoveryConnection(ownerOpenId: string, connectionId: string) {
  const connection = await getTenantConnection(ownerOpenId, connectionId);
  if (!connection) return { ok: false as const, status: "error" as const, detail: "Source tenant connection was not found." };
  if (connection.direction !== "source") return { ok: false as const, status: "error" as const, detail: "Discovery can only run against a source tenant connection." };
  const token = await getAppAccessTokenForConnection(connection);
  if (!token) return { ok: false as const, status: "not_configured" as const, detail: "Source tenant credentials are incomplete." };
  try {
    const organization = await graphGet<{ value?: Array<{ displayName?: string }> }>(token, "/organization?$select=displayName");
    const permissions = Object.fromEntries((Object.keys(labels) as DiscoveryWorkload[]).map((workload) => [workload, inspectGraphPermissions(token, workload, "source")]));
    const missing = (Object.entries(permissions) as Array<[DiscoveryWorkload, ReturnType<typeof inspectGraphPermissions>]>).flatMap(([workload, result]) => result.missingPermissions.map((permission) => `${labels[workload]}: ${permission}`));
    if (missing.length) return { ok: false as const, status: "error" as const, displayName: organization.value?.[0]?.displayName, permissions, detail: `Source connection is reachable, but discovery permissions are incomplete: ${missing.join(", ")}. Grant admin consent and test again.` };
    return { ok: true as const, status: "connected" as const, displayName: organization.value?.[0]?.displayName, permissions };
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
  const workloads = await Promise.all((Object.keys(labels) as DiscoveryWorkload[]).map((workload) => workloadResult(token, workload, "source")));
  const permissionErrors = workloads.filter((item) => item.status === "permission_required").map((item) => `${item.label}: ${item.permission} is required`);
  const assessment: DiscoveryAssessment = { id: `DISC-${Date.now().toString(36)}`, connectionId, tenantId: connection.tenantId, tenantLabel: connection.label, organizationName: organization.value?.[0]?.displayName, status: permissionErrors.length === workloads.length ? "blocked" : "completed", startedAt, completedAt: new Date().toISOString(), workloads, permissionErrors };
  assessments.set(ownerOpenId, assessment);
  return assessment;
}

export function latestDiscovery(ownerOpenId: string) { return assessments.get(ownerOpenId) ?? null; }

export function discoveryCsv(assessment: DiscoveryAssessment) {
  const rows = [["Workload", "Status", "Items", "Size", "Detail"], ...assessment.workloads.map((item) => [item.label, item.status, String(item.itemCount), item.sizeLabel, item.detail])];
  return rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
}
