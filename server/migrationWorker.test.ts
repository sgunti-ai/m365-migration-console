import { describe, expect, it } from "vitest";
import { enqueueSharePointStaging, getWorkerTelemetry, isMigrationQueueConfigured, startMigrationWorker, stopMigrationWorker } from "./migrationWorker";

describe("migration worker", () => {
  it("does not start a background worker without Redis configuration", async () => {
    if (process.env.REDIS_URL) return;
    expect(isMigrationQueueConfigured()).toBe(false);
    expect(startMigrationWorker()).toBeNull();
    expect(await enqueueSharePointStaging({ migrationJobId: "JOB-1", driveId: "DRIVE-1", rootItemId: "root" })).toBe(false);
    await stopMigrationWorker();
  });

  it("returns a safe disabled telemetry snapshot without Redis", async () => {
    if (process.env.REDIS_URL) return;
    const telemetry = await getWorkerTelemetry();
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.queues.staging.waiting).toBe(0);
    expect(telemetry.counters.retryRate).toBe(0);
  });
});
