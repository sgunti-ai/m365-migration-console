import { nanoid } from "nanoid";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "./_core/trpc";
import { addWaveDependency, createMigrationProject, createMigrationWave, getMigrationProject, getMigrationWave, listMigrationProjects, listMigrationWaves, listWavePopulations, updateMigrationProject, updateMigrationWave } from "./migrationPlanningRepo";
import { canTransitionWave, migrationPhases } from "./migrationPlanningRules";

const waveStatus = z.enum(["Planned", "Ready", "Running", "Paused", "Completed", "Needs review", "Blocked"]);

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
    create: protectedProcedure.input(z.object({ projectId: z.string().min(1), name: z.string().min(2).max(160), runMode: z.enum(["Full", "Incremental", "Cutover"]).default("Full"), validationPolicy: z.string().max(64).default("Standard"), itemsTotal: z.number().int().min(0).default(0) })).mutation(async ({ ctx, input }) => {
      const project = await getMigrationProject(input.projectId, ctx.user.openId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Migration project not found" });
      const existing = await listMigrationWaves(input.projectId, ctx.user.openId);
      return createMigrationWave({ id: `WAV-${nanoid(8).toUpperCase()}`, projectId: input.projectId, ownerOpenId: ctx.user.openId, name: input.name, sequence: existing.length + 1, phase: existing.length === 0 ? "Pilot" : "Planning", status: "Planned", runMode: input.runMode, validationPolicy: input.validationPolicy, itemsTotal: input.itemsTotal, itemsDone: 0, progress: 0, concurrency: "Balanced", approvalState: "Pending" });
    }),
    approve: protectedProcedure.input(z.object({ waveId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const wave = await getMigrationWave(input.waveId, ctx.user.openId);
      if (!wave) throw new TRPCError({ code: "NOT_FOUND", message: "Migration wave not found" });
      return updateMigrationWave(wave.id, ctx.user.openId, { approvalState: "Approved" });
    }),
    transition: protectedProcedure.input(z.object({ waveId: z.string().min(1), status: waveStatus })).mutation(async ({ ctx, input }) => {
      const wave = await getMigrationWave(input.waveId, ctx.user.openId);
      if (!wave) throw new TRPCError({ code: "NOT_FOUND", message: "Migration wave not found" });
      const currentStatus = wave.status ?? "Planned";
      const approvalState = wave.approvalState ?? "Pending";
      if (!canTransitionWave(currentStatus, input.status, approvalState)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Wave cannot transition from ${currentStatus} to ${input.status} until its approval and phase gates are satisfied.` });
      return updateMigrationWave(wave.id, ctx.user.openId, { status: input.status, phase: input.status === "Completed" ? "Validation" : wave.phase });
    }),
    populations: protectedProcedure.input(z.object({ waveId: z.string().min(1) })).query(async ({ ctx, input }) => {
      const wave = await getMigrationWave(input.waveId, ctx.user.openId);
      if (!wave) throw new TRPCError({ code: "NOT_FOUND", message: "Migration wave not found" });
      return listWavePopulations(input.waveId);
    }),
    addDependency: protectedProcedure.input(z.object({ waveId: z.string().min(1), dependsOnWaveId: z.string().min(1), dependencyType: z.enum(["Completion", "Approval", "Mapping"]).default("Completion") })).mutation(async ({ ctx, input }) => {
      const wave = await getMigrationWave(input.waveId, ctx.user.openId);
      const dependency = await getMigrationWave(input.dependsOnWaveId, ctx.user.openId);
      if (!wave || !dependency) throw new TRPCError({ code: "NOT_FOUND", message: "Migration wave not found" });
      if (wave.projectId !== dependency.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "Wave dependencies must stay within one project" });
      return addWaveDependency(input.waveId, input.dependsOnWaveId, input.dependencyType);
    }),
  }),
});
