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

export type StagingCheckpoint = {
  packageId: string;
  completedItemIds: string[];
  stagedFiles: number;
  totalFiles: number;
  updatedAt?: string;
};

export type StagingProgress = StagingCheckpoint & {
  active: number;
  lastItemId?: string;
  lastPath?: string;
};

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

export function createMigrationManifests(items: OneDriveMigrationItem[], packageId: string = randomUUID()) {
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

async function withRetry<T>(operation: () => Promise<T>, attempts = 3, baseDelayMs = 500) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Staging operation failed");
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(workers);
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
  return stageOneDrivePackageResumable(items, { config });
}

export async function stageOneDrivePackageResumable(items: OneDriveMigrationItem[], options: {
  config?: SharePointMigrationConfig;
  checkpoint?: Partial<StagingCheckpoint>;
  concurrency?: number;
  retryAttempts?: number;
  onProgress?: (progress: StagingProgress) => Promise<void> | void;
} = {}) {
  const config = options.config ?? requiredConfig();
  const files = items.filter(candidate => !candidate.isFolder);
  const packageId = options.checkpoint?.packageId ?? randomUUID();
  const completed = new Set(options.checkpoint?.completedItemIds ?? []);
  const pending = files.filter(item => !completed.has(item.itemId));
  let stagedFiles = options.checkpoint?.stagedFiles ?? files.filter(item => completed.has(item.itemId)).length;
  const failed: Array<{ itemId: string; relativePath: string; detail: string }> = [];
  const emitProgress = async (item?: OneDriveMigrationItem) => options.onProgress?.({ packageId, completedItemIds: Array.from(completed), stagedFiles, totalFiles: files.length, active: 0, lastItemId: item?.itemId, lastPath: item?.relativePath, updatedAt: new Date().toISOString() });
  await emitProgress();
  await mapWithConcurrency(pending, options.concurrency ?? 4, async (item) => {
    try {
      await withRetry(async () => {
        const bytes = await downloadSourceItem(item);
        await putBlob(withBlobPath(config.sourceContainerSasUri, item.relativePath), bytes, "application/octet-stream");
      }, options.retryAttempts ?? 3);
      completed.add(item.itemId);
      stagedFiles += 1;
      await emitProgress(item);
    } catch (error) {
      failed.push({ itemId: item.itemId, relativePath: item.relativePath, detail: error instanceof Error ? error.message : "Unknown staging error" });
    }
  });
  if (failed.length) {
    const detail = failed.map(item => `${item.relativePath}: ${item.detail}`).join("; ");
    throw new Error(`Staging incomplete (${failed.length} file(s) failed). Resume from checkpoint. ${detail}`);
  }
  const manifests = createMigrationManifests(items, packageId);
  for (const [name, xml] of Object.entries(manifests.files)) {
    await withRetry(() => putBlob(withBlobPath(config.manifestContainerSasUri, `${packageId}/${name}`), xml, "application/xml; charset=utf-8"), options.retryAttempts ?? 3);
  }
  return { packageId, stagedFiles, totalItems: items.length, manifestFiles: Object.keys(manifests.files), checkpoint: { packageId, completedItemIds: Array.from(completed), stagedFiles, totalFiles: files.length, updatedAt: new Date().toISOString() } satisfies StagingCheckpoint };
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
