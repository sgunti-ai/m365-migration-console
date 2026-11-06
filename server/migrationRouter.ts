import { nanoid } from "nanoid";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { checkGraphHealth, checkGraphHealthForConnection, discoverGraphUsers } from "./graph";
import { appendMigrationEvent, createMigrationJob, getMigrationJob, listMigrationEvents, listMigrationJobs, updateMigrationJob } from "./migrationRepo";
import { getSharePointMigrationProgress } from "./sharepointMigration";
import { enqueueSharePointPolling, enqueueSharePointStaging, getWorkerTelemetry } from "./migrationWorker";
import { buildPreflightChecks, summarizePreflight } from "./migrationPreflight";
import { createRemediationItems, createValidation, getLatestValidation, getRemediationItem, listRemediationItems, updateRemediationItem } from "./migrationPreflightRepo";
import { listTenantConnections } from "./localAuth";
import { isThrottlingIncident } from "./migrationIncidentRules";

const workloads = z.enum(["OneDrive", "SharePoint", "Exchange", "Teams"]);
const status = z.enum(["Queued", "Running", "Paused", "Completed", "Needs review", "Failed", "Cancelled"]);

function assertOwner(job: Awaited<ReturnType<typeof getMigrationJob>>, openId: string) {
  if (!job || job.ownerOpenId !== openId) throw new TRPCError({ code: "NOT_FOUND", message: "Migration job not found" });
  return job;
}

export const migrationRouter = router({
  worker: router({
    telemetry: protectedProcedure.query(() => getWorkerTelemetry()),
    recentIncidents: protectedProcedure.query(async ({ ctx }) => {
      const jobs = await listMigrationJobs(ctx.user.openId);
      const failedJobs = jobs.filter(job => job.status === "Failed").slice(0, 12).map(job => ({ id: job.id, name: job.name, workload: job.workload, status: job.status, progress: job.progress, errors: job.errors, eta: job.eta, started: job.started }));
      const eventGroups = await Promise.all(jobs.slice(0, 30).map(async job => (await listMigrationEvents(job.id, 30)).filter(event => isThrottlingIncident(event.type, event.payload)).map(event => ({ id: `${job.id}-${event.id}`, jobId: job.id, jobName: job.name, type: event.type, payload: event.payload, createdAt: event.createdAt }))));
      return { failedJobs, throttlingEvents: eventGroups.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 20) };
    }),
  }),
  jobs: router({
    list: protectedProcedure.query(({ ctx }) => listMigrationJobs(ctx.user.openId)),
    events: protectedProcedure.input(z.object({ jobId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) })).query(async ({ ctx, input }) => {
      assertOwner(await getMigrationJob(input.jobId), ctx.user.openId);
      return listMigrationEvents(input.jobId, input.limit);
    }),
    create: protectedProcedure.input(z.object({
      name: z.string().min(3).max(160),
      workload: workloads,
      scope: z.string().min(1).max(255),
      concurrency: z.string().min(1).max(32),
      batchMode: z.boolean().default(false),
      batchSize: z.string().max(64).optional(),
      schedule: z.string().max(64).optional(),
      scheduledAt: z.date().nullable().optional(),
      itemsTotal: z.number().int().min(0).default(0),
      projectId: z.string().max(32).optional(),
      waveId: z.string().max(32).optional(),
      phase: z.enum(["Assessment", "Mapping", "Planning", "Pilot", "Migration", "Validation", "Cutover", "Completed"]).default("Migration"),
    })).mutation(({ ctx, input }) => createMigrationJob({
      id: `JOB-${nanoid(8).toUpperCase()}`,
      ...input,
      batchMode: input.batchMode ? 1 : 0,
      status: "Queued",
      ownerOpenId: ctx.user.openId,
      eta: input.schedule === "Start after approval" ? "Awaiting approval" : input.scheduledAt ? "Scheduled" : "Queued",
    })),
    control: protectedProcedure.input(z.object({ jobId: z.string().min(1), action: z.enum(["pause", "resume", "retry", "cancel"]) })).mutation(async ({ ctx, input }) => {
      const job = assertOwner(await getMigrationJob(input.jobId), ctx.user.openId);
      if (input.action === "resume" || input.action === "retry") {
        const validation = await getLatestValidation(job.id, ctx.user.openId);
        if (!validation || validation.status !== "Passed") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Run and pass pre-flight validation before resuming or retrying this job." });
      }
      const next = input.action === "pause" ? "Paused" : input.action === "cancel" ? "Cancelled" : "Running";
      const checkpoint = input.action === "pause" ? JSON.stringify({ progress: job.progress, itemsDone: job.itemsDone, pausedAt: new Date().toISOString() }) : job.checkpoint;
      const updated = await updateMigrationJob(job.id, { status: next, checkpoint, eta: input.action === "cancel" ? "Cancelled" : input.action === "pause" ? "Paused" : "Resuming from checkpoint", lastError: input.action === "retry" ? null : job.lastError });
      await appendMigrationEvent(job.id, `job.${input.action}`, { action: input.action, checkpoint: checkpoint ? JSON.parse(checkpoint) : null, at: new Date().toISOString() });
      return updated;
    }),
    checkpoint: protectedProcedure.input(z.object({ jobId: z.string().min(1), progress: z.number().int().min(0).max(100), itemsDone: z.number().int().min(0), itemsTotal: z.number().int().min(0), throughputGbHr: z.number().int().min(0).default(0), checkpoint: z.record(z.string(), z.unknown()).optional(), status: status.optional() })).mutation(async ({ ctx, input }) => {
      const job = assertOwner(await getMigrationJob(input.jobId), ctx.user.openId);
      return updateMigrationJob(job.id, { progress: input.progress, itemsDone: input.itemsDone, itemsTotal: input.itemsTotal, throughputGbHr: input.throughputGbHr, checkpoint: input.checkpoint ? JSON.stringify(input.checkpoint) : job.checkpoint, status: input.status ?? job.status, eta: input.progress >= 100 ? "Complete" : job.eta });
    }),
  }),
  preflight: router({
    run: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const job = assertOwner(await getMigrationJob(input.jobId), ctx.user.openId);
      const startedAt = new Date();
      const connections = await listTenantConnections(ctx.user.openId);
      const health = await Promise.all(((["source", "target"] as const)).map(async (direction) => {
        const connection = connections.find((item) => item.direction === direction);
        return connection ? checkGraphHealthForConnection(ctx.user.openId, connection.id) : checkGraphHealth(direction);
      }));
      const checks = buildPreflightChecks(job, health);
      const summary = summarizePreflight(checks);
      const validation = await createValidation({ id: `VAL-${nanoid(10).toUpperCase()}`, jobId: job.id, ownerOpenId: ctx.user.openId, workload: job.workload, status: summary.status, score: summary.score, checks: JSON.stringify(checks), startedAt, completedAt: new Date() });
      const existing = await listRemediationItems(ctx.user.openId, { jobId: job.id });
      const pendingCodes = new Set(existing.filter((item) => item.status === "Open" || item.status === "In progress").map((item) => item.code));
      const newItems = await createRemediationItems(checks.filter((check) => check.status !== "Passed" && !pendingCodes.has(check.code)).map((check) => ({ jobId: job.id, ownerOpenId: ctx.user.openId, workload: job.workload, code: check.code, entity: `${job.name} · ${check.title}`, severity: check.severity, status: "Open" as const, retryable: check.retryable ? 1 : 0, recommendation: check.recommendation, attempts: 0, lastError: check.detail, nextRetryAt: null })));
      const updatedJob = summary.status === "Passed" ? job : await updateMigrationJob(job.id, { status: "Needs review", eta: `Pre-flight ${summary.status.toLowerCase()}`, lastError: `${summary.needsReview + summary.blocked} pre-flight check(s) need attention.` });
      await appendMigrationEvent(job.id, "preflight.completed", { validationId: validation.id, summary, health, checkCodes: checks.map((check) => check.code), at: new Date().toISOString() });
      return { validation, summary, remediationItems: newItems, job: updatedJob };
    }),
    latest: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).query(async ({ ctx, input }) => {
      assertOwner(await getMigrationJob(input.jobId), ctx.user.openId);
      const validation = await getLatestValidation(input.jobId, ctx.user.openId);
      const remediationItems = await listRemediationItems(ctx.user.openId, { jobId: input.jobId });
      return { validation, remediationItems };
    }),
  }),
  remediation: router({
    list: protectedProcedure.input(z.object({ jobId: z.string().min(1).optional(), workload: workloads.optional(), status: z.enum(["Open", "In progress", "Resolved", "Waived"]).optional() }).optional()).query(({ ctx, input }) => listRemediationItems(ctx.user.openId, input)),
    resolve: protectedProcedure.input(z.object({ itemId: z.number().int().positive(), status: z.enum(["Resolved", "Waived"]) })).mutation(async ({ ctx, input }) => {
      const item = await getRemediationItem(input.itemId, ctx.user.openId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Remediation item not found" });
      const updated = await updateRemediationItem(item.id, ctx.user.openId, { status: input.status, nextRetryAt: null });
      await appendMigrationEvent(item.jobId, "remediation.resolved", { itemId: item.id, status: input.status, code: item.code, at: new Date().toISOString() });
      return updated;
    }),
    retry: protectedProcedure.input(z.object({ itemId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const item = await getRemediationItem(input.itemId, ctx.user.openId);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Remediation item not found" });
      if (!item.retryable) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This remediation is not safe to retry automatically" });
      const updated = await updateRemediationItem(item.id, ctx.user.openId, { status: "In progress", attempts: item.attempts + 1, lastError: null, nextRetryAt: new Date() });
      await appendMigrationEvent(item.jobId, "remediation.retry_queued", { itemId: item.id, attempt: item.attempts + 1, code: item.code, at: new Date().toISOString() });
      return updated;
    }),
  }),
  sharePoint: router({
    stageAndSubmit: protectedProcedure.input(z.object({ jobId: z.string().min(1), driveId: z.string().min(1), rootItemId: z.string().min(1).default("root") })).mutation(async ({ ctx, input }) => {
      const job = assertOwner(await getMigrationJob(input.jobId), ctx.user.openId);
      const queued = await enqueueSharePointStaging({ migrationJobId: job.id, driveId: input.driveId, rootItemId: input.rootItemId });
      if (!queued) {
        await appendMigrationEvent(job.id, "sharepoint.staging_waiting", { detail: "REDIS_URL is not configured; background staging is disabled." });
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Redis is required for background SharePoint staging. Configure REDIS_URL and retry." });
      }
      const updated = await updateMigrationJob(job.id, { status: "Queued", progress: Math.max(job.progress, 1), eta: "Queued for background staging", lastError: null });
      await appendMigrationEvent(job.id, "sharepoint.staging.queued", { driveId: input.driveId, rootItemId: input.rootItemId });
      return updated;
    }),
    poll: protectedProcedure.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const job = assertOwner(await getMigrationJob(input.jobId), ctx.user.openId);
      const checkpoint = job.checkpoint ? JSON.parse(job.checkpoint) as { sharePointJobId?: string; nextToken?: string } : {};
      if (!checkpoint.sharePointJobId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This job has not been submitted to SharePoint Migration API." });
      const progress = await getSharePointMigrationProgress(checkpoint.sharePointJobId, checkpoint.nextToken ?? "0");
      const last = progress.events.at(-1);
      const total = Number(last?.TotalExpectedSPObjects ?? job.itemsTotal);
      const done = Number(last?.ObjectsProcessed ?? job.itemsDone);
      const percent = last?.Event === "JobEnd" ? 100 : total > 0 ? Math.min(99, Math.round((done / total) * 100)) : job.progress;
      const nextCheckpoint = { ...checkpoint, nextToken: progress.nextToken, lastEvent: last?.Event ?? null, polledAt: new Date().toISOString() };
      const updated = await updateMigrationJob(job.id, { status: last?.Event === "JobEnd" ? "Completed" : last?.Event === "JobError" ? "Failed" : job.status, progress: percent, itemsDone: done, itemsTotal: total, checkpoint: JSON.stringify(nextCheckpoint), eta: last?.Event === "JobEnd" ? "Complete" : job.eta, lastError: last?.Event === "JobError" ? String(last.Message ?? "SharePoint Migration API reported an error") : job.lastError });
      await appendMigrationEvent(job.id, "sharepoint.progress", { events: progress.events, nextToken: progress.nextToken });
      return { job: updated, events: progress.events, nextToken: progress.nextToken };
    }),
  }),
  graph: router({
    health: protectedProcedure.query(async () => Promise.all([checkGraphHealth("source"), checkGraphHealth("target")])),
    discoverUsers: protectedProcedure.input(z.object({ tenant: z.enum(["source", "target"]), limit: z.number().int().min(1).max(999).default(100) })).query(({ input }) => discoverGraphUsers(input.tenant, input.limit)),
  }),
});
