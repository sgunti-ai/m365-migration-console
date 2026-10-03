import { nanoid } from "nanoid";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { addWaveDependency, createMigrationProject, createMigrationWave, ensureMigrationRunbook, getMigrationProject, getMigrationRunbook, getMigrationWave, listMigrationProjects, listMigrationWaves, listRunbookSteps, listWaveDependencies, listWavePopulations, updateMigrationProject, updateMigrationRunbook, updateMigrationWave, updateRunbookStep } from "./migrationPlanningRepo";
import { canTransitionWave, migrationPhases } from "./migrationPlanningRules";

const waveStatus = z.enum(["Planned", "Ready", "Running", "Paused", "Completed", "Needs review", "Blocked"]);
const runbookStatus = z.enum(["Draft", "Ready", "In progress", "Completed", "Blocked"]);
const stepStatus = z.enum(["Pending", "In progress", "Completed", "Blocked", "Skipped"]);

export const migrationPlanningRouter = router({
  projects: router({
    list: protectedProcedure.query(({ ctx }) => listMigrationProjects(ctx.user.openId)),
    create: protectedProcedure.input(z.object({ name: z.string().min(3).max(160), description: z.string().max(1000).optional(), sourceConnectionId: z.string().max(32).optional(), targetConnectionId: z.string().max(32).optional() })).mutation(({ ctx, input }) => createMigrationProject({ id: `PRJ-${nanoid(8).toUpperCase()}`, ownerOpenId: ctx.user.openId, name: input.name, description: input.description, sourceConnectionId: input.sourceConnectionId, targetConnectionId: input.targetConnectionId, phase: "Assessment", status: "Draft", readinessScore: 0 })),
    advancePhase: protectedProcedure.input(z.object({ projectId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const project = await getMigrationProject(input.projectId, ctx.user.openId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Migration project not found" });
      const next = migrationPhases[Math.min(migrationPhases.indexOf(project.phase as typeof migrationPhases[number]) + 1, migrationPhases.length - 1)];
      return updateMigrationProject(project.id, ctx.user.openId, { phase: next, status: next === "Completed" ? "Completed" : "Active" });
    }),
  }),
  waves: router({
    list: protectedProcedure.input(z.object({ projectId: z.string().min(1) })).query(async ({ ctx, input }) => {
      const project = await getMigrationProject(input.projectId, ctx.user.openId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Migration project not found" });
      return listMigrationWaves(input.projectId, ctx.user.openId);
    }),
    dependencies: protectedProcedure.input(z.object({ projectId: z.string().min(1) })).query(async ({ ctx, input }) => {
      const project = await getMigrationProject(input.projectId, ctx.user.openId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Migration project not found" });
      const waves = await listMigrationWaves(input.projectId, ctx.user.openId);
      const dependencies = await listWaveDependencies(waves.map((wave) => wave.id), ctx.user.openId);
      return dependencies.map((dependency) => ({
        ...dependency,
        fromWave: waves.find((wave) => wave.id === dependency.dependsOnWaveId)?.name ?? dependency.dependsOnWaveId,
        toWave: waves.find((wave) => wave.id === dependency.waveId)?.name ?? dependency.waveId,
        fromStatus: waves.find((wave) => wave.id === dependency.dependsOnWaveId)?.status ?? "Planned",
        toStatus: waves.find((wave) => wave.id === dependency.waveId)?.status ?? "Planned",
      }));
    }),
    create: protectedProcedure.input(z.object({ projectId: z.string().min(1), name: z.string().min(2).max(160), runMode: z.enum(["Full", "Incremental", "Cutover"]).default("Full"), validationPolicy: z.string().max(64).default("Standard"), itemsTotal: z.number().int().min(0).default(0) })).mutation(async ({ ctx, input }) => {
      const project = await getMigrationProject(input.projectId, ctx.user.openId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Migration project not found" });
      const existing = await listMigrationWaves(input.projectId, ctx.user.openId);
      return createMigrationWave({ id: `WAV-${nanoid(8).toUpperCase()}`, projectId: input.projectId, ownerOpenId: ctx.user.openId, name: input.name, sequence: existing.length + 1, phase: existing.length === 0 ? "Pilot" : "Planning", status: "Planned", runMode: input.runMode, validationPolicy: input.validationPolicy, itemsTotal: input.itemsTotal, itemsDone: 0, progress: 0, concurrency: "Balanced", approvalState: "Pending" });
    }),
    approve: protectedProcedure.input(z.object({ waveId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const wave = await getMigrationWave(input.waveId, ctx.user.openId); if (!wave) throw new TRPCError({ code: "NOT_FOUND", message: "Migration wave not found" }); return updateMigrationWave(wave.id, ctx.user.openId, { approvalState: "Approved" });
    }),
    transition: protectedProcedure.input(z.object({ waveId: z.string().min(1), status: waveStatus })).mutation(async ({ ctx, input }) => {
      const wave = await getMigrationWave(input.waveId, ctx.user.openId); if (!wave) throw new TRPCError({ code: "NOT_FOUND", message: "Migration wave not found" });
      const currentStatus = wave.status ?? "Planned"; const approvalState = wave.approvalState ?? "Pending";
      if (!canTransitionWave(currentStatus, input.status, approvalState)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Wave cannot transition from ${currentStatus} to ${input.status} until its approval and phase gates are satisfied.` });
      return updateMigrationWave(wave.id, ctx.user.openId, { status: input.status, phase: input.status === "Completed" ? "Validation" : wave.phase });
    }),
    populations: protectedProcedure.input(z.object({ waveId: z.string().min(1) })).query(async ({ ctx, input }) => { const wave = await getMigrationWave(input.waveId, ctx.user.openId); if (!wave) throw new TRPCError({ code: "NOT_FOUND", message: "Migration wave not found" }); return listWavePopulations(input.waveId); }),
    addDependency: protectedProcedure.input(z.object({ waveId: z.string().min(1), dependsOnWaveId: z.string().min(1), dependencyType: z.enum(["Completion", "Approval", "Mapping"]).default("Completion") })).mutation(async ({ ctx, input }) => {
      if (input.waveId === input.dependsOnWaveId) throw new TRPCError({ code: "BAD_REQUEST", message: "A wave cannot depend on itself" });
      const wave = await getMigrationWave(input.waveId, ctx.user.openId); const dependency = await getMigrationWave(input.dependsOnWaveId, ctx.user.openId);
      if (!wave || !dependency) throw new TRPCError({ code: "NOT_FOUND", message: "Migration wave not found" }); if (wave.projectId !== dependency.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "Wave dependencies must stay within one project" });
      return addWaveDependency(input.waveId, input.dependsOnWaveId, input.dependencyType);
    }),
  }),
  runbooks: router({
    get: protectedProcedure.input(z.object({ projectId: z.string().min(1), targetWaveId: z.string().optional() })).query(async ({ ctx, input }) => {
      const project = await getMigrationProject(input.projectId, ctx.user.openId); if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Migration project not found" });
      const runbook = await ensureMigrationRunbook(input.projectId, ctx.user.openId, input.targetWaveId); if (!runbook) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Unable to initialize cutover runbook" });
      return { runbook, steps: await listRunbookSteps(runbook.id), waves: await listMigrationWaves(input.projectId, ctx.user.openId) };
    }),
    update: protectedProcedure.input(z.object({ runbookId: z.string().min(1), status: runbookStatus.optional(), scheduledAt: z.date().nullable().optional(), changeFreezeAt: z.date().nullable().optional(), rollbackWindowMinutes: z.number().int().min(15).max(1440).optional() })).mutation(async ({ ctx, input }) => {
      const patch = { status: input.status, scheduledAt: input.scheduledAt, changeFreezeAt: input.changeFreezeAt, rollbackWindowMinutes: input.rollbackWindowMinutes };
      const updated = await updateMigrationRunbook(input.runbookId, ctx.user.openId, patch); if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Cutover runbook not found" }); return updated;
    }),
    updateStep: protectedProcedure.input(z.object({ runbookId: z.string().min(1), stepId: z.number().int().positive(), status: stepStatus, evidence: z.string().max(2000).nullable().optional() })).mutation(async ({ ctx, input }) => {
      const runbook = await getMigrationRunbookById(input.runbookId, ctx.user.openId); if (!runbook) throw new TRPCError({ code: "NOT_FOUND", message: "Cutover runbook not found" });
      const updated = await updateRunbookStep(input.stepId, input.runbookId, input.status, input.evidence); if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Runbook step not found" }); return updated;
    }),
  }),
});

async function getMigrationRunbookById(runbookId: string, ownerOpenId: string) {
  // The repository is project-oriented for the UI, so verify ownership through the project-linked runbook query.
  // The direct id check is intentionally kept in the router boundary by searching the caller's visible projects.
  const projects = await listMigrationProjects(ownerOpenId);
  for (const project of projects) { const runbook = await getMigrationRunbook(project.id, ownerOpenId); if (runbook?.id === runbookId) return runbook; }
  return undefined;
}
