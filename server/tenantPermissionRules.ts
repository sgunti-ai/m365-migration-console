export type TenantWorkload = "oneDrive" | "sharePoint" | "exchange" | "teams";
export type GraphTenantDirection = "source" | "target";

export function requiredGraphPermissions(workload: TenantWorkload, direction: GraphTenantDirection): string[] {
  if (workload === "oneDrive") return [direction === "target" ? "Files.ReadWrite.All" : "Files.Read.All"];
  if (workload === "sharePoint") return [direction === "target" ? "Sites.ReadWrite.All" : "Sites.Read.All"];
  if (workload === "exchange") return ["Mail.ReadWrite.All"];
  return direction === "target" ? ["Team.ReadBasic.All", "ChannelMessage.Read.All", "TeamSettings.ReadWrite.All"] : ["Team.ReadBasic.All", "ChannelMessage.Read.All"];
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function inspectGraphPermissions(token: string, workload: TenantWorkload, direction: GraphTenantDirection) {
  const payload = decodeJwtPayload(token);
  const grantedPermissions = Array.isArray(payload?.roles) ? payload.roles.filter((role): role is string => typeof role === "string") : [];
  const requiredPermissions = requiredGraphPermissions(workload, direction);
  const missingPermissions = requiredPermissions.filter((permission) => !grantedPermissions.includes(permission));
  return { requiredPermissions, grantedPermissions, missingPermissions, hasInspectableRoles: Boolean(payload && Array.isArray(payload.roles)) };
}
