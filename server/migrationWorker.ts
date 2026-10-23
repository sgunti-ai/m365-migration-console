import { Queue, Worker, type Job } from "bullmq";
import { ENV } from "./_core/env";
import { appendMigrationEvent, getMigrationJob, updateMigrationJob } from "./migrationRepo";
import { enumerateOneDriveItems, getSharePointMigrationProgress, stageOneDrivePackageResumable, submitSharePointMigration } from "./sharepointMigration";

export type SharePointPollJob = { migrationJobId: string };
export type SharePointStageJob = { migrationJobId: string; driveId: string; rootItemId: string };

const queueName = "m365-sharepoint-migration";
const stagingQueueName = "m365-sharepoint-staging";
let pollQueue: Queue<SharePointPollJob> | null = null;
let stagingQueue: Queue<SharePointStageJob> | null = null;
let pollWorker: Worker<SharePointPollJob> | null = null;
let stagingWorker: Worker<SharePointStageJob> | null = null;

function redisConnection() {
  if (!ENV.redisUrl) return null;
  const url = new URL(ENV.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export function isMigrationQueueConfigured() {
  return Boolean(ENV.redisUrl);
}

export async function enqueueSharePointStaging(input: SharePointStageJob) {
  if (!stagingQueue) return false;
  await stagingQueue.add("stage-package", input, {
    jobId: `stage-${input.migrationJobId}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 1000,
  });
  return true;
}

export async function enqueueSharePointPolling(migrationJobId: string, delay = 0) {
  if (!pollQueue) return false;
  await pollQueue.add("poll-progress", { migrationJobId }, {
    delay,
    attempts: 6,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 1000,
  });
  return true;
}

async function stageSharePointJob(job: Job<SharePointStageJob>) {
  const record = await getMigrationJob(job.data.migrationJobId);
  if (!record || ["Completed", "Cancelled"].includes(record.status)) return { status: record?.status ?? "missing" };
  try {
    const items = await enumerateOneDriveItems(job.data.driveId, job.data.rootItemId);
    await updateMigrationJob(record.id, { status: "Running", itemsTotal: items.length, progress: Math.max(record.progress, 1), eta: "Package staging" });
    const priorCheckpoint = record.checkpoint ? JSON.parse(record.checkpoint) as { staging?: { packageId?: string; completedItemIds?: string[]; stagedFiles?: number; totalFiles?: number } } : {};
    const staged = await stageOneDrivePackageResumable(items, {
      checkpoint: priorCheckpoint.staging,
      onProgress: async (progress) => {
        const percent = progress.totalFiles > 0 ? Math.min(90, Math.max(1, 5 + Math.round((progress.stagedFiles / progress.totalFiles) * 80))) : 5;
        const checkpoint = { provider: "SharePoint Migration API", driveId: job.data.driveId, rootItemId: job.data.rootItemId, staging: progress };
        await updateMigrationJob(record.id, { status: "Running", progress: percent, itemsDone: progress.stagedFiles, itemsTotal: items.length, checkpoint: JSON.stringify(checkpoint), eta: `Staging ${progress.stagedFiles}/${progress.totalFiles} files` });
        await appendMigrationEvent(record.id, "sharepoint.staging.progress", { ...progress, workerJobId: job.id });
      },
    });
    const submitted = await submitSharePointMigration();
    const checkpoint = { provider: "SharePoint Migration API", packageId: staged.packageId, sharePointJobId: submitted.jobId, nextToken: "0", driveId: job.data.driveId, rootItemId: job.data.rootItemId, stagedFiles: staged.stagedFiles, totalItems: staged.totalItems };
    await updateMigrationJob(record.id, { status: "Running", progress: 2, itemsTotal: staged.totalItems, itemsDone: staged.stagedFiles, checkpoint: JSON.stringify(checkpoint), eta: "Queued by SharePoint", lastError: null });
    await appendMigrationEvent(record.id, "sharepoint.submitted", { ...checkpoint, workerJobId: job.id });
    const queued = await enqueueSharePointPolling(record.id, 5000);
    if (!queued) await appendMigrationEvent(record.id, "sharepoint.polling_waiting", { detail: "Polling queue is unavailable after submission; use manual poll or restart the worker." });
    return { status: "submitted", sharePointJobId: submitted.jobId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "SharePoint staging worker failed";
    const maxAttempts = Number(job.opts.attempts ?? 1);
    const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
    await updateMigrationJob(record.id, { status: finalAttempt ? "Failed" : "Running", lastError: detail, eta: finalAttempt ? "Failed" : `Retrying staging (${job.attemptsMade + 1}/${maxAttempts})` });
    await appendMigrationEvent(record.id, finalAttempt ? "sharepoint.staging.failed" : "sharepoint.staging.retry", { detail, attempt: job.attemptsMade + 1, maxAttempts, workerJobId: job.id });
    throw error;
  }
}

async function pollSharePointJob(job: Job<SharePointPollJob>) {
  const record = await getMigrationJob(job.data.migrationJobId);
  if (!record || ["Completed", "Cancelled", "Failed"].includes(record.status)) return { status: record?.status ?? "missing" };
  const checkpoint = record.checkpoint ? JSON.parse(record.checkpoint) as { sharePointJobId?: string; nextToken?: string } : {};
  if (!checkpoint.sharePointJobId) return { status: "waiting-for-submission" };

  const result = await getSharePointMigrationProgress(checkpoint.sharePointJobId, checkpoint.nextToken ?? "0");
  const last = result.events.at(-1);
  const total = Number(last?.TotalExpectedSPObjects ?? record.itemsTotal);
  const done = Number(last?.ObjectsProcessed ?? record.itemsDone);
  const terminal = last?.Event === "JobEnd" || last?.Event === "JobError";
  const nextStatus = last?.Event === "JobEnd" ? "Completed" : last?.Event === "JobError" ? "Failed" : "Running";
  const nextCheckpoint = { ...checkpoint, nextToken: result.nextToken, lastEvent: last?.Event ?? null, polledAt: new Date().toISOString() };
  await updateMigrationJob(record.id, {
    status: nextStatus,
    progress: last?.Event === "JobEnd" ? 100 : total > 0 ? Math.min(99, Math.round((done / total) * 100)) : record.progress,
    itemsDone: done,
    itemsTotal: total,
    checkpoint: JSON.stringify(nextCheckpoint),
    eta: last?.Event === "JobEnd" ? "Complete" : record.eta,
    lastError: last?.Event === "JobError" ? String(last.Message ?? "SharePoint Migration API reported an error") : record.lastError,
  });
  await appendMigrationEvent(record.id, "sharepoint.progress", { events: result.events, nextToken: result.nextToken, workerJobId: job.id });
  if (!terminal) await enqueueSharePointPolling(record.id, 5000);
  return { status: nextStatus, events: result.events.length, nextToken: result.nextToken };
}

export function startMigrationWorker() {
  const connection = redisConnection();
  if (!connection) {
    console.warn("[MigrationWorker] REDIS_URL is not configured; automatic staging and polling are disabled.");
    return null;
  }
  pollQueue = new Queue<SharePointPollJob>(queueName, { connection });
  stagingQueue = new Queue<SharePointStageJob>(stagingQueueName, { connection });
  pollWorker = new Worker<SharePointPollJob>(queueName, pollSharePointJob, { connection, concurrency: 2, limiter: { max: 20, duration: 1000 } });
  stagingWorker = new Worker<SharePointStageJob>(stagingQueueName, stageSharePointJob, { connection, concurrency: 1, limiter: { max: 4, duration: 1000 } });
  pollWorker.on("completed", job => console.log(`[MigrationWorker] completed poll ${job.id}`));
  stagingWorker.on("completed", job => console.log(`[MigrationWorker] completed staging ${job.id}`));
  pollWorker.on("failed", (job, error) => console.error(`[MigrationWorker] poll failed ${job?.id ?? "unknown"}:`, error.message));
  stagingWorker.on("failed", (job, error) => console.error(`[MigrationWorker] staging failed ${job?.id ?? "unknown"}:`, error.message));
  console.log(`[MigrationWorker] BullMQ workers started on ${queueName} and ${stagingQueueName}`);
  return stagingWorker;
}

export async function stopMigrationWorker() {
  await stagingWorker?.close();
  await pollWorker?.close();
  await stagingQueue?.close();
  await pollQueue?.close();
  stagingWorker = null;
  pollWorker = null;
  stagingQueue = null;
  pollQueue = null;
}
