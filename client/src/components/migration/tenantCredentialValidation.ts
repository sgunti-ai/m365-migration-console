export type TenantWorkload = "oneDrive" | "sharePoint" | "exchange" | "teams";

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tenantDomainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.onmicrosoft\.com$/i;

export function validateTenantCredentialFormat(input: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrl?: string;
  direction: "source" | "target";
}): string[] {
  const errors: string[] = [];
  const tenantId = input.tenantId.trim();
  const clientId = input.clientId.trim();
  const secret = input.clientSecret;
  if (!guidPattern.test(tenantId) && !tenantDomainPattern.test(tenantId)) errors.push("Enter a valid Entra tenant GUID or *.onmicrosoft.com domain.");
  if (!guidPattern.test(clientId)) errors.push("Enter a valid app registration client ID GUID.");
  if (secret.length < 8 || secret.length > 200 || secret.trim() !== secret || /[\r\n]/.test(secret)) errors.push("Enter the client secret value exactly as issued by Microsoft Entra.");
  if (input.direction === "target" && input.siteUrl?.trim()) {
    try {
      const url = new URL(input.siteUrl.trim());
      if (url.protocol !== "https:" || !url.hostname.endsWith("sharepoint.com")) errors.push("Use an HTTPS SharePoint Online site URL for the destination tenant.");
    } catch {
      errors.push("Enter a valid HTTPS SharePoint Online site URL.");
    }
  }
  return errors;
}

export const workloadLabels: Record<TenantWorkload, string> = {
  oneDrive: "OneDrive",
  sharePoint: "SharePoint",
  exchange: "Exchange Online",
  teams: "Microsoft Teams",
};
