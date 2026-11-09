import { describe, expect, it } from "vitest";
import { validateTenantCredentialFormat } from "./tenantCredentialValidation";

describe("tenant credential format validation", () => {
  const valid = { direction: "source" as const, tenantId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222", clientSecret: "valid-secret-value" };

  it("accepts valid Entra identifiers and secret values", () => {
    expect(validateTenantCredentialFormat(valid)).toEqual([]);
  });

  it("rejects malformed identifiers and unsafe secret formatting", () => {
    const errors = validateTenantCredentialFormat({ ...valid, tenantId: "not-a-tenant", clientId: "not-a-client", clientSecret: " bad\nsecret " });
    expect(errors).toHaveLength(3);
  });

  it("requires a secure SharePoint URL for destination connections when supplied", () => {
    const errors = validateTenantCredentialFormat({ ...valid, direction: "target", siteUrl: "http://example.org/site" });
    expect(errors[0]).toContain("HTTPS SharePoint Online");
  });
});
