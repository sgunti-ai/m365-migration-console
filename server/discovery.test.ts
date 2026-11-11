import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantConnection } from "./localAuth";
import { discoveryCsv, runSourceDiscovery, testSourceDiscoveryConnection } from "./discovery";

describe("source discovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exports workload inventory as a CSV report", () => {
    const csv = discoveryCsv({
      id: "DISC-test",
      connectionId: "TEN-test",
      tenantId: "tenant-guid",
      tenantLabel: "Source tenant",
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:01:00.000Z",
      workloads: [{ workload: "oneDrive", label: "OneDrive", status: "discovered", itemCount: 12, sizeBytes: null, sizeLabel: "Calculated during workload scan", detail: "12 users" }],
      permissionErrors: [],
    });
    expect(csv).toContain('"Workload","Status","Items","Size","Detail"');
    expect(csv).toContain('"OneDrive","discovered","12"');
  });

  it("rejects a missing or non-source connection before scanning", async () => {
    await expect(runSourceDiscovery("local:discovery-test-user", "TEN-missing")).rejects.toThrow("saved source tenant connection");
    const connection = await createTenantConnection({ ownerOpenId: "local:discovery-test-user", label: "Target", direction: "target", tenantId: "tenant-guid", clientId: "client-guid", clientSecret: "secret" });
    await expect(runSourceDiscovery("local:discovery-test-user", connection!.id)).rejects.toThrow("saved source tenant connection");
  });

  it("reports incomplete discovery permissions during the source connection test", async () => {
    const connection = await createTenantConnection({ ownerOpenId: "local:permission-test-user", label: "Source", direction: "source", tenantId: "tenant-guid", clientId: "client-guid", clientSecret: "secret" });
    const payload = Buffer.from(JSON.stringify({ roles: ["Files.Read.All"] })).toString("base64url");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("login.microsoftonline.com")
      ? new Response(JSON.stringify({ access_token: `header.${payload}.signature` }), { status: 200 })
      : new Response(JSON.stringify({ value: [{ displayName: "Source tenant" }] }), { status: 200 })));
    const result = await testSourceDiscoveryConnection("local:permission-test-user", connection!.id);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("discovery permissions are incomplete");
    expect(result.detail).toContain("Sites.Read.All");
  });
});
