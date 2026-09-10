import { afterEach, describe, expect, it, vi } from "vitest";
import { checkGraphHealthForConnection, getAppAccessTokenForConnection } from "./graph";
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
});
