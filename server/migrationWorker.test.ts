import { describe, expect, it } from "vitest";
import { enqueueSharePointStaging, isMigrationQueueConfigured, startMigrationWorker, stopMigrationWorker } from "./migrationWorker";

describe("migration worker", () => {
  it("does not start a background worker without Redis configuration", async () => {
    if (process.env.REDIS_URL) return;
    expect(isMigrationQueueConfigured()).toBe(false);
    expect(startMigrationWorker()).toBeNull();
    expect(await enqueueSharePointStaging({ migrationJobId: "JOB-1", driveId: "DRIVE-1", rootItemId: "root" })).toBe(false);
    await stopMigrationWorker();
  });
});
