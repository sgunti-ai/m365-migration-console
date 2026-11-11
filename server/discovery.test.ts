import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantConnection } from "./localAuth";
import { createInventoryRun, discoveryCsv, runDetailedWorkloadInventory, runSourceDiscovery, subscribeInventoryProgress, testSourceDiscoveryConnection } from "./discovery";

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

  it("builds a guided Entra consent checklist for missing workload permissions", async () => {
    const connection = await createTenantConnection({ ownerOpenId: "local:checklist-user", label: "Source", direction: "source", tenantId: "tenant-guid", clientId: "client-guid", clientSecret: "secret" });
    const payload = Buffer.from(JSON.stringify({ roles: ["Files.Read.All"] })).toString("base64url");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("login.microsoftonline.com")
      ? new Response(JSON.stringify({ access_token: `header.${payload}.signature` }), { status: 200 })
      : new Response(JSON.stringify({ value: [{ displayName: "Source tenant" }], "@odata.count": 1 }), { status: 200 })));
    const result = await runSourceDiscovery("local:checklist-user", connection!.id);
    expect(result.permissionChecklist.length).toBeGreaterThan(0);
    expect(result.permissionChecklist.some((item) => item.permission === "Sites.Read.All")).toBe(true);
    expect(result.permissionChecklist[0].adminConsentUrl).toContain("tenant-guid/adminconsent");
    expect(result.permissionChecklist[0].apiPermissionsUrl).toContain("entra.microsoft.com");
  });

  it("aggregates detailed sizes across drives, sites, mailboxes, and Teams files", async () => {
    const connection = await createTenantConnection({ ownerOpenId: "local:inventory-user", label: "Source", direction: "source", tenantId: "tenant-guid", clientId: "client-guid", clientSecret: "secret" });
    const roles = ["Files.Read.All", "Sites.Read.All", "Mail.ReadWrite.All", "Reports.Read.All", "Team.ReadBasic.All", "ChannelMessage.Read.All"];
    const payload = Buffer.from(JSON.stringify({ roles })).toString("base64url");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: `header.${payload}.signature` }), { status: 200 });
      if (url.includes("/organization")) return new Response(JSON.stringify({ value: [{ displayName: "Source tenant" }] }), { status: 200 });
      if (url.includes("/users?page=2")) return new Response(JSON.stringify({ value: [{ id: "user-2" }] }), { status: 200 });
      if (url.includes("/users?")) return new Response(JSON.stringify({ value: [{ id: "user-1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users?page=2" }), { status: 200 });
      if (url.includes("/sites?page=2")) return new Response(JSON.stringify({ value: [{ id: "site-2" }] }), { status: 200 });
      if (url.includes("/sites?")) return new Response(JSON.stringify({ value: [{ id: "site-1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites?page=2" }), { status: 200 });
      if (url.includes("/teams?page=2")) return new Response(JSON.stringify({ value: [{ id: "team-2" }] }), { status: 200 });
      if (url.includes("/teams?")) return new Response(JSON.stringify({ value: [{ id: "team-1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/teams?page=2" }), { status: 200 });
      if (url.includes("/reports/")) return new Response('User,Storage Used (Byte)\nuser@example.com,4096\n', { status: 200 });
      if (url.includes("/users/user-1/drive")) return new Response(JSON.stringify({ quota: { used: 1024 } }), { status: 200 });
      if (url.includes("/users/user-2/drive")) return new Response(JSON.stringify({ quota: { used: 2048 } }), { status: 200 });
      if (url.includes("/sites/site-1/drive")) return new Response(JSON.stringify({ quota: { used: 2048 } }), { status: 200 });
      if (url.includes("/sites/site-2/drive")) return new Response(JSON.stringify({ quota: { used: 4096 } }), { status: 200 });
      if (url.includes("/groups/team-1/drive")) return new Response(JSON.stringify({ quota: { used: 3072 } }), { status: 200 });
      if (url.includes("/groups/team-2/drive")) return new Response(JSON.stringify({ quota: { used: 5120 } }), { status: 200 });
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }));
    const assessment = await runSourceDiscovery("local:inventory-user", connection!.id);
    await createInventoryRun("local:inventory-user", assessment.id, connection!.id);
    const progressEvents: number[] = [];
    const unsubscribe = subscribeInventoryProgress("local:inventory-user", assessment.id, (event) => progressEvents.push(event.inventory.progress));
    const inventory = await runDetailedWorkloadInventory("local:inventory-user", connection!.id, assessment.id);
    unsubscribe();
    expect(inventory.status).toBe("completed");
    expect(inventory.progress).toBe(100);
    expect(inventory.totalSizeBytes).toBe(21504);
    expect(inventory.workloadResults.find((item) => item.workload === "exchange")?.sizeBytes).toBe(4096);
    expect(progressEvents).toContain(25);
    expect(progressEvents).toContain(100);
    expect(inventory.workloadResults.find((item) => item.workload === "exchange")?.sizeBytes).toBe(4096);
  });
});
