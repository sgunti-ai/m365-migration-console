import { describe, expect, it } from "vitest";
import { isMigrationQueueConfigured, startMigrationWorker, stopMigrationWorker } from "./migrationWorker";

describe("migration worker", () => {
  it("does not start a background worker without Redis configuration", async () => {
    if (process.env.REDIS_URL) return;
    expect(isMigrationQueueConfigured()).toBe(false);
    expect(startMigrationWorker()).toBeNull();
    await stopMigrationWorker();
  });
});
