import { describe, expect, it } from "vitest";
import { evaluateTargetAccountReadiness } from "./graph";

describe("target account readiness", () => {
  it("requires a license and usage location", () => {
    const result = evaluateTargetAccountReadiness({ id: "u1", userPrincipalName: "test1@testsecondary.co.in", accountEnabled: true }, "oneDrive");
    expect(result.status).toBe("needs_license");
    expect(result.detail).toContain("usageLocation");
  });

  it("blocks disabled and non-member target accounts", () => {
    expect(evaluateTargetAccountReadiness({ id: "u1", accountEnabled: false, usageLocation: "IN", assignedLicenses: [{ skuId: "sku" }] }).status).toBe("blocked");
    expect(evaluateTargetAccountReadiness({ id: "u2", accountEnabled: true, userType: "Guest", usageLocation: "IN", assignedLicenses: [{ skuId: "sku" }] }).status).toBe("blocked");
  });

  it("marks an enabled member with usage location and a license as ready", () => {
    const result = evaluateTargetAccountReadiness({ id: "u3", accountEnabled: true, userType: "Member", usageLocation: "IN", assignedLicenses: [{ skuId: "sku" }] }, "exchange");
    expect(result.status).toBe("ready");
    expect(result.assignedLicenseCount).toBe(1);
    expect(result.requiredLicense).toContain("Exchange");
  });
});
