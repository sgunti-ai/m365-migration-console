import { describe, expect, it } from "vitest";
import { canTransitionWave, migrationPhases, nextMigrationPhase, runbookCompletionPercent } from "./migrationPlanningRules";

describe("migration planning rules", () => {
  it("advances project phases without exceeding Completed", () => {
    expect(nextMigrationPhase("Assessment")).toBe("Mapping");
    expect(nextMigrationPhase("Cutover")).toBe("Completed");
    expect(nextMigrationPhase("Completed")).toBe("Completed");
    expect(migrationPhases).toHaveLength(8);
  });

  it("requires approval before a planned wave becomes ready or running", () => {
    expect(canTransitionWave("Planned", "Ready", "Pending")).toBe(false);
    expect(canTransitionWave("Planned", "Ready", "Approved")).toBe(true);
    expect(canTransitionWave("Ready", "Running", "Approved")).toBe(true);
    expect(canTransitionWave("Planned", "Running", "Approved")).toBe(false);
  });

  it("only allows completion from an active or review state", () => {
    expect(canTransitionWave("Running", "Completed", "Approved")).toBe(true);
    expect(canTransitionWave("Needs review", "Completed", "Approved")).toBe(true);
    expect(canTransitionWave("Planned", "Completed", "Approved")).toBe(false);
  });

  it("calculates runbook progress from completed gates", () => {
    expect(runbookCompletionPercent([])).toBe(0);
    expect(runbookCompletionPercent(["Completed", "Pending", "Blocked", "Completed"])).toBe(50);
    expect(runbookCompletionPercent(["Completed", "Completed"])).toBe(100);
  });
});
