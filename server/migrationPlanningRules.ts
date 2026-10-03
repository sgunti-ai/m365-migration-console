export const migrationPhases = ["Assessment", "Mapping", "Planning", "Pilot", "Migration", "Validation", "Cutover", "Completed"] as const;
export type MigrationPhase = (typeof migrationPhases)[number];
export const migrationWaveStatuses = ["Planned", "Ready", "Running", "Paused", "Completed", "Needs review", "Blocked"] as const;
export type MigrationWaveStatus = (typeof migrationWaveStatuses)[number];
export type ApprovalState = "Not required" | "Pending" | "Approved" | "Rejected";

export function nextMigrationPhase(current: MigrationPhase): MigrationPhase {
  const index = migrationPhases.indexOf(current);
  return migrationPhases[Math.min(index + 1, migrationPhases.length - 1)];
}

export function canTransitionWave(status: MigrationWaveStatus, next: MigrationWaveStatus, approvalState: ApprovalState) {
  if (next === "Ready") return status === "Planned" && (approvalState === "Approved" || approvalState === "Not required");
  if (next === "Running") return status === "Ready" && (approvalState === "Approved" || approvalState === "Not required");
  if (next === "Completed") return status === "Running" || status === "Needs review";
  return true;
}

export function runbookCompletionPercent(statuses: string[]) {
  if (!statuses.length) return 0;
  return Math.round((statuses.filter((status) => status === "Completed").length / statuses.length) * 100);
}
