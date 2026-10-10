import { describe, expect, it } from "vitest";
import { stripUntrustedIdentityHeaders } from "./_core/security";

describe("request identity boundary", () => {
  it("removes caller-controlled admin identity headers", () => {
    const headers = {
      "x-admin-role": "GLOBAL_ADMIN",
      "x-admin-email": "attacker@example.com",
      authorization: "Bearer verified-token",
      cookie: "porterline_local_session=verified-session",
    };

    stripUntrustedIdentityHeaders(headers);

    expect(headers).not.toHaveProperty("x-admin-role");
    expect(headers).not.toHaveProperty("x-admin-email");
    expect(headers.authorization).toBe("Bearer verified-token");
    expect(headers.cookie).toBe("porterline_local_session=verified-session");
  });
});
