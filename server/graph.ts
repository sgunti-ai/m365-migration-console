import { ENV } from "./_core/env";

export type GraphTenant = "source" | "target";

type GraphConfig = { tenantId: string; clientId: string; clientSecret: string };

export type GraphHealth = {
  tenant: GraphTenant;
  configured: boolean;
  status: "connected" | "not_configured" | "error";
  displayName?: string;
  tenantId?: string;
  detail: string;
};

function configFor(tenant: GraphTenant): GraphConfig {
  return tenant === "source"
    ? { tenantId: ENV.graph.sourceTenantId, clientId: ENV.graph.sourceClientId, clientSecret: ENV.graph.sourceClientSecret }
    : { tenantId: ENV.graph.targetTenantId, clientId: ENV.graph.targetClientId, clientSecret: ENV.graph.targetClientSecret };
}

export function isGraphConfigured(tenant: GraphTenant) {
  const config = configFor(tenant);
  return Boolean(config.tenantId && config.clientId && config.clientSecret);
}

export async function getAppAccessToken(tenant: GraphTenant, resource = "https://graph.microsoft.com") {
  const config = configFor(tenant);
  if (!config.tenantId || !config.clientId || !config.clientSecret) return null;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: `${resource.replace(/\/$/, "")}/.default`,
  });
  const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Token request failed with ${response.status}`);
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Token response did not include an access token");
  return payload.access_token;
}

export async function getGraphAccessToken(tenant: GraphTenant) {
  return getAppAccessToken(tenant, "https://graph.microsoft.com");
}

async function graphGet<T>(tenant: GraphTenant, path: string): Promise<T> {
  const token = await getGraphAccessToken(tenant);
  if (!token) throw new Error(`Microsoft Graph ${tenant} tenant is not configured`);
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Graph ${response.status}: ${detail.slice(0, 240)}`);
  }
  return response.json() as Promise<T>;
}

export async function checkGraphHealth(tenant: GraphTenant): Promise<GraphHealth> {
  const config = configFor(tenant);
  if (!isGraphConfigured(tenant)) return { tenant, configured: false, status: "not_configured", tenantId: config.tenantId || undefined, detail: "Add tenant ID, client ID, and client secret to enable live Microsoft Graph access." };
  try {
    const organization = await graphGet<{ value?: Array<{ displayName?: string }> }>(tenant, "/organization?$select=displayName");
    return { tenant, configured: true, status: "connected", tenantId: config.tenantId, displayName: organization.value?.[0]?.displayName, detail: "Microsoft Graph client-credentials connection is healthy." };
  } catch (error) {
    return { tenant, configured: true, status: "error", tenantId: config.tenantId, detail: error instanceof Error ? error.message : "Microsoft Graph health check failed." };
  }
}

export async function discoverGraphUsers(tenant: GraphTenant, limit = 100) {
  const query = `/users?$select=id,displayName,userPrincipalName,mail,accountEnabled&$top=${Math.min(limit, 999)}`;
  return graphGet<{ value: Array<{ id: string; displayName?: string; userPrincipalName?: string; mail?: string; accountEnabled?: boolean }> }>(tenant, query);
}
