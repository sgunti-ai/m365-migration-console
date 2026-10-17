import { describe, expect, it } from "vitest";
import type { MigrationJob } from "../drizzle/schema";
import { buildPreflightChecks, summarizePreflight } from "./migrationPreflight";

function job(workload: string, overrides: Partial<MigrationJob> = {}) {
  return {
    id: "JOB-TEST",
    name: `${workload} pilot`,
    workload,
    scope: "Users discovered in Finance",
    ownerOpenId: "owner-1",
    status: "Queued",
    progress: 0,
    itemsDone: 0,
    itemsTotal: 50,
    throughputGbHr: 0,
    eta: "Queued",
    concurrency: "Balanced",
    batchMode: 0,
    batchSize: null,
    schedule: null,
    scheduledAt: null,
    checkpoint: null,
    lastError: null,
    projectId: null,
    waveId: null,
    phase: "Migration",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as MigrationJob;
}

const healthyTenants = [
  { tenant: "source" as const, configured: true, status: "connected" as const, detail: "healthy" },
  { tenant: "target" as const, configured: true, status: "connected" as const, detail: "healthy" },
];

describe("migration pre-flight rules", () => {
  it("passes access, mapping, and batch checks when tenant connections are healthy", () => {
    const checks = buildPreflightChecks(job("Exchange"), healthyTenants);
    expect(checks.find((check) => check.code === "TENANT_GRAPH_ACCESS")?.status).toBe("Passed");
    expect(checks.find((check) => check.code === "IDENTITY_MAPPING")?.status).toBe("Passed");
    expect(checks.find((check) => check.code === "BATCH_CONTROL")?.status).toBe("Passed");
  });

  it("blocks live execution when either tenant is not configured", () => {
    const checks = buildPreflightChecks(job("OneDrive"), [
      { tenant: "source" as const, configured: false, status: "not_configured" as const, detail: "missing" },
      { tenant: "target" as const, configured: true, status: "connected" as const, detail: "healthy" },
    ]);
    const summary = summarizePreflight(checks);
    expect(summary.status).toBe("Blocked");
    expect(checks.find((check) => check.code === "TENANT_GRAPH_ACCESS")?.retryable).toBe(true);
  });

  it.each([
    ["OneDrive", "ONEDRIVE_LINKS_PERMISSIONS"],
    ["SharePoint", "SHAREPOINT_AUTOMATION_DEPENDENCIES"],
    ["Exchange", "EXCHANGE_MAIL_FLOW"],
    ["Teams", "TEAMS_WORKLOAD_DEPENDENCIES"],
  ])("adds a workload-specific dependency recommendation for %s", (workload, code) => {
    const checks = buildPreflightChecks(job(workload), healthyTenants);
    expect(checks.some((check) => check.code === code && check.recommendation.length > 20)).toBe(true);
  });

  it("requires batching for a large unbatched population", () => {
    const checks = buildPreflightChecks(job("SharePoint", { itemsTotal: 101 }), healthyTenants);
    const summary = summarizePreflight(checks);
    expect(checks.find((check) => check.code === "BATCH_CONTROL")?.status).toBe("Needs review");
    expect(summary.needsReview).toBeGreaterThan(0);
  });
});
