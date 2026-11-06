export const WORKER_TELEMETRY_THRESHOLDS = {
  throttlesWarning: 3,
  throttlesCritical: 10,
  failedJobRateWarning: 10,
  failedJobRateCritical: 25,
} as const;

export type WorkerRisk = {
  level: "safe" | "warning" | "critical";
  reasons: string[];
};

export function evaluateWorkerRisk(input: { throttles: number; failedJobRate: number }): WorkerRisk {
  const reasons: string[] = [];
  if (input.throttles >= WORKER_TELEMETRY_THRESHOLDS.throttlesWarning) reasons.push(`${input.throttles} throttling events detected`);
  if (input.failedJobRate >= WORKER_TELEMETRY_THRESHOLDS.failedJobRateWarning) reasons.push(`${input.failedJobRate}% of completed jobs failed`);
  const critical = input.throttles >= WORKER_TELEMETRY_THRESHOLDS.throttlesCritical || input.failedJobRate >= WORKER_TELEMETRY_THRESHOLDS.failedJobRateCritical;
  return { level: critical ? "critical" : reasons.length ? "warning" : "safe", reasons };
}
