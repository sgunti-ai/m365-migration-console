import { randomUUID } from "node:crypto";
import { ENV } from "./_core/env";
import { getAppAccessToken, getGraphAccessToken } from "./graph";

export type OneDriveMigrationItem = {
  driveId: string;
  itemId: string;
  name: string;
  relativePath: string;
  size?: number;
  isFolder?: boolean;
  sourceUrl?: string;
};

export type SharePointMigrationConfig = {
  targetSiteUrl: string;
  targetWebId: string;
  sourceContainerSasUri: string;
  manifestContainerSasUri: string;
  queueReportSasUri?: string | null;
};

export type MigrationProgressEvent = Record<string, string | number | boolean | null> & { Event?: string };

type GraphDriveItem = {
  id: string;
  name: string;
  size?: number;
  file?: unknown;
  folder?: unknown;
  parentReference?: { path?: string };
  "@microsoft.graph.downloadUrl"?: string;
};

function requiredConfig(): SharePointMigrationConfig {
  const config = {
    targetSiteUrl: ENV.sharePoint.targetSiteUrl,
    targetWebId: ENV.sharePoint.targetWebId,
    sourceContainerSasUri: ENV.sharePoint.sourceContainerSasUri,
    manifestContainerSasUri: ENV.sharePoint.manifestContainerSasUri,
    queueReportSasUri: ENV.sharePoint.queueReportSasUri || null,
  };
  const missing = Object.entries(config).filter(([key, value]) => key !== "queueReportSasUri" && !value).map(([key]) => key);
  if (missing.length) throw new Error(`SharePoint Migration API is not configured: ${missing.join(", ")}`);
  return config;
}

function withBlobPath(containerSasUri: string, blobName: string) {
  const url = new URL(containerSasUri);
  const encodedPath = blobName.split("/").map(segment => encodeURIComponent(segment)).join("/");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodedPath}`;
  return url.toString();
}

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[char]!);
}

export function createMigrationManifests(items: OneDriveMigrationItem[]) {
  const packageId = randomUUID();
  const files = items.filter(item => !item.isFolder);
  const folders = items.filter(item => item.isFolder);
  const manifestItems = [
    ...folders.map(item => `<Folder Url="${escapeXml(item.relativePath)}" Id="${escapeXml(item.itemId)}" />`),
    ...files.map(item => `<File Url="${escapeXml(item.relativePath)}" Id="${escapeXml(item.itemId)}" FileSize="${item.size ?? 0}" />`),
  ].join("");
  const manifest = `<?xml version="1.0" encoding="utf-8"?><SPObjects xmlns="http://schemas.microsoft.com/sharepoint/2012/1/migration/manifest"><Folder Id="${packageId}" Url="/">${manifestItems}</Folder></SPObjects>`;
  const exportSettings = `<?xml version="1.0" encoding="utf-8"?><ExportSettings xmlns="urn:deployment-exportsettings-schema" SourceType="OneDrive" FileLocation="${escapeXml(packageId)}" IncludeSecurity="All"><ExportObjects /></ExportSettings>`;
  const systemData = `<?xml version="1.0" encoding="utf-8"?><SystemData xmlns="urn:deployment-systemdata-schema"><SchemaVersion Version="15.0.0.0" Build="16.0.0.0" DatabaseVersion="11552" SiteVersion="15" /><ManifestFiles><ManifestFile Name="Manifest.xml" /></ManifestFiles><SystemObjects /></SystemData>`;
  const userGroupMap = `<?xml version="1.0" encoding="utf-8"?><UserGroupMap xmlns="urn:deployment-usergroupmap-schema" />`;
  return { packageId, files: { "Manifest.xml": manifest, "ExportSettings.xml": exportSettings, "SystemData.xml": systemData, "UserGroupMap.xml": userGroupMap } };
}

async function putBlob(url: string, body: BodyInit, contentType: string) {
  const response = await fetch(url, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType }, body });
  if (!response.ok) throw new Error(`Azure Blob upload failed with ${response.status}`);
}

async function downloadSourceItem(item: OneDriveMigrationItem) {
  const token = await getGraphAccessToken("source");
  if (!token) throw new Error("Source Microsoft Graph is not configured");
  const url = item.sourceUrl ?? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(item.driveId)}/items/${encodeURIComponent(item.itemId)}/content`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Source OneDrive download failed with ${response.status} for ${item.relativePath}`);
  return response.arrayBuffer();
}

export async function enumerateOneDriveItems(driveId: string, rootItemId = "root") {
  const token = await getGraphAccessToken("source");
  if (!token) throw new Error("Source Microsoft Graph is not configured");
  const pending = [{ id: rootItemId, path: "" }];
  const items: OneDriveMigrationItem[] = [];
  while (pending.length) {
    const current = pending.shift()!;
    let nextUrl: string | undefined = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(current.id)}/children?$select=id,name,size,file,folder,parentReference,@microsoft.graph.downloadUrl&$top=200`;
    while (nextUrl) {
      const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (!response.ok) throw new Error(`OneDrive enumeration failed with ${response.status}`);
      const payload = (await response.json()) as { value?: GraphDriveItem[]; "@odata.nextLink"?: string };
      for (const child of payload.value ?? []) {
        const relativePath = `${current.path}/${child.name}`.replace(/^\//, "");
        const isFolder = Boolean(child.folder);
        items.push({ driveId, itemId: child.id, name: child.name, relativePath, size: child.size, isFolder, sourceUrl: child["@microsoft.graph.downloadUrl"] });
        if (isFolder) pending.push({ id: child.id, path: relativePath });
      }
      nextUrl = payload["@odata.nextLink"];
    }
  }
  return items;
}

export async function stageOneDrivePackage(items: OneDriveMigrationItem[], config = requiredConfig()) {
  const manifests = createMigrationManifests(items);
  let stagedFiles = 0;
  for (const item of items.filter(candidate => !candidate.isFolder)) {
    const bytes = await downloadSourceItem(item);
    await putBlob(withBlobPath(config.sourceContainerSasUri, item.relativePath), bytes, "application/octet-stream");
    stagedFiles += 1;
  }
  for (const [name, xml] of Object.entries(manifests.files)) {
    await putBlob(withBlobPath(config.manifestContainerSasUri, `${manifests.packageId}/${name}`), xml, "application/xml; charset=utf-8");
  }
  return { packageId: manifests.packageId, stagedFiles, totalItems: items.length, manifestFiles: Object.keys(manifests.files) };
}

async function sharePointRequest(config: SharePointMigrationConfig, path: string, init: RequestInit) {
  const sharePointResource = new URL(config.targetSiteUrl).origin;
  const token = await getAppAccessToken("target", sharePointResource);
  if (!token) throw new Error("Target Microsoft Graph is not configured");
  const response = await fetch(`${config.targetSiteUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { Accept: "application/json;odata=verbose", Authorization: `Bearer ${token}`, "Content-Type": "application/json;odata=verbose", ...(init.headers ?? {}) },
  });
  if (response.status === 429 || response.status === 503) {
    const retryAfter = response.headers.get("retry-after") ?? "unknown";
    throw new Error(`SharePoint Migration API throttled the request (${response.status}); retry-after=${retryAfter}`);
  }
  if (!response.ok) throw new Error(`SharePoint Migration API returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function submitSharePointMigration(config = requiredConfig()) {
  const result = await sharePointRequest(config, "/_api/site/CreateMigrationJob", {
    method: "POST",
    body: JSON.stringify({
      gWebId: config.targetWebId,
      azureContainerSourceUri: config.sourceContainerSasUri,
      azureContainerManifestUri: config.manifestContainerSasUri,
      azureQueueReportUri: config.queueReportSasUri ?? null,
    }),
  });
  const envelope = result.d as Record<string, unknown> | undefined;
  const jobId = envelope?.CreateMigrationJob ?? result.CreateMigrationJob ?? result.jobId;
  if (typeof jobId !== "string") throw new Error("SharePoint Migration API did not return a job ID");
  return { jobId };
}

export async function getSharePointMigrationProgress(jobId: string, nextToken = "0", config = requiredConfig()) {
  const result = await sharePointRequest(config, `/_api/site/GetMigrationJobProgress(jobId='${encodeURIComponent(jobId)}',nextToken=${encodeURIComponent(nextToken)})`, { method: "GET" });
  const envelope = result.d as Record<string, unknown> | undefined;
  const progress = (envelope?.GetMigrationJobProgress ?? result.GetMigrationJobProgress ?? {}) as { Logs?: { results?: string[] }; NextToken?: string };
  const events = (progress.Logs?.results ?? []).map(raw => {
    try { return JSON.parse(raw) as MigrationProgressEvent; } catch { return { Event: "Unknown", Raw: raw }; }
  });
  return { events, nextToken: progress.NextToken ?? nextToken };
}
