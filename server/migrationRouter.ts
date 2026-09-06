import { nanoid } from "nanoid";
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { checkGraphHealth, discoverGraphUsers } from "./graph";
import { appendMigrationEvent, createMigrationJob, getMigrationJob, listMigrationEvents, listMigrationJobs, updateMigrationJob } from "./migrationRepo";

const workloads = z.enum(["OneDrive", "SharePoint", "Exchange", "Teams"]);
const status = z.enum(["Queued", "Running", "Paused", "Completed", "Needs review", "Failed", "Cancelled"]);

function assertOwner(job: Awaited<ReturnType<typeof getMigrationJob>>, openId: string) {
  if (!job || job.ownerOpenId !== openId) throw new Error("Migration job not found");
  return job;
}

export const migrationRouter = router({
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
  graph: router({
    health: protectedProcedure.query(async () => Promise.all([checkGraphHealth("source"), checkGraphHealth("target")])),
    discoverUsers: protectedProcedure.input(z.object({ tenant: z.enum(["source", "target"]), limit: z.number().int().min(1).max(999).default(100) })).query(({ input }) => discoverGraphUsers(input.tenant, input.limit)),
  }),
});
