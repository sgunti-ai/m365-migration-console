import { afterEach, describe, expect, it, vi } from "vitest";
import { checkGraphHealthForConnection, checkGraphHealthForCredentials, getAppAccessTokenForConnection } from "./graph";
import { encryptCredential } from "./credentialVault";

describe("dynamic Graph connection", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests a Graph token using the connection's encrypted client secret", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toContain("login.microsoftonline.com/tenant-guid/oauth2/v2.0/token");
      expect(String(init?.body)).toContain("client_id=client-guid");
      expect(String(init?.body)).toContain("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default");
      expect(String(init?.body)).toContain("client_secret=one-time-secret");
      return new Response(JSON.stringify({ access_token: "graph-access-token" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const token = await getAppAccessTokenForConnection({
      id: "TEN-test",
      ownerOpenId: "local:admin",
      direction: "source",
      tenantId: "tenant-guid",
      clientId: "client-guid",
      clientSecretCiphertext: encryptCredential("one-time-secret"),
    });

    expect(token).toBe("graph-access-token");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails safely when the requested connection does not belong to the user", async () => {
    const health = await checkGraphHealthForConnection("local:graph-test-user", "TEN-does-not-exist");
    expect(health.status).toBe("error");
    expect(health.detail).toContain("not found");
  });

  it("tests entered credentials without requiring a stored connection", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("login.microsoftonline.com")) {
        expect(String(init?.body)).toContain("client_secret=one-time-secret");
        const payload = Buffer.from(JSON.stringify({ roles: ["Files.Read.All"] })).toString("base64url");
        return new Response(JSON.stringify({ access_token: `header.${payload}.signature` }), { status: 200 });
      }
      return new Response(JSON.stringify({ value: [{ displayName: "Pilot tenant" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const health = await checkGraphHealthForCredentials({ tenant: "source", tenantId: "tenant-guid", clientId: "client-guid", clientSecret: "one-time-secret", workload: "oneDrive" });
    expect(health.status).toBe("connected");
    expect(health.displayName).toBe("Pilot tenant");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports missing workload permissions without calling Graph organization", async () => {
    const payload = Buffer.from(JSON.stringify({ roles: ["Files.Read.All"] })).toString("base64url");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).includes("login.microsoftonline.com")
      ? new Response(JSON.stringify({ access_token: `header.${payload}.signature` }), { status: 200 })
      : new Response(JSON.stringify({ value: [{ displayName: "Unexpected call" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const health = await checkGraphHealthForCredentials({ tenant: "target", tenantId: "tenant-guid", clientId: "client-guid", clientSecret: "one-time-secret", workload: "oneDrive" });
    expect(health.status).toBe("error");
    expect(health.missingPermissions).toContain("Files.ReadWrite.All");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
