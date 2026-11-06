import { describe, expect, it } from "vitest";
import { evaluateWorkerRisk, WORKER_TELEMETRY_THRESHOLDS } from "./workerTelemetryRisk";

describe("worker telemetry risk", () => {
  it("stays safe below both thresholds", () => {
    expect(evaluateWorkerRisk({ throttles: WORKER_TELEMETRY_THRESHOLDS.throttlesWarning - 1, failedJobRate: WORKER_TELEMETRY_THRESHOLDS.failedJobRateWarning - 1 })).toEqual({ level: "safe", reasons: [] });
  });

  it("warns when throttling or failed-job rate exceeds the safe threshold", () => {
    const result = evaluateWorkerRisk({ throttles: WORKER_TELEMETRY_THRESHOLDS.throttlesWarning, failedJobRate: 0 });
    expect(result.level).toBe("warning");
    expect(result.reasons[0]).toContain("throttling");
    expect(evaluateWorkerRisk({ throttles: 0, failedJobRate: WORKER_TELEMETRY_THRESHOLDS.failedJobRateWarning }).level).toBe("warning");
  });

  it("escalates to critical for severe throttling or failure rates", () => {
    expect(evaluateWorkerRisk({ throttles: WORKER_TELEMETRY_THRESHOLDS.throttlesCritical, failedJobRate: 0 }).level).toBe("critical");
    expect(evaluateWorkerRisk({ throttles: 0, failedJobRate: WORKER_TELEMETRY_THRESHOLDS.failedJobRateCritical }).level).toBe("critical");
  });
});
