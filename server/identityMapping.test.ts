import { describe, expect, it } from "vitest";
import { buildMappingProposals, mappingsCsv } from "./identityMapping";

describe("identity mapping proposals", () => {
  it("proposes a rewritten target UPN without silently approving it", () => {
    const [mapping] = buildMappingProposals(
      [{ id: "source-1", userPrincipalName: "test1@contoso.com", mail: "test1@contoso.com", displayName: "Test One" }],
      [{ id: "target-1", userPrincipalName: "test1@testsecondary.co.in", mail: "test1@testsecondary.co.in", accountEnabled: true }],
      "contoso.com",
      "testsecondary.co.in",
    );
    expect(mapping.targetUserId).toBe("target-1");
    expect(mapping.targetUpn).toBe("test1@testsecondary.co.in");
    expect(mapping.matchMethod).toBe("domain_rewrite");
    expect(mapping.status).toBe("needs_review");
    expect(mapping.decision).toBe("review");
    expect(mapping.explanation).toContain("test1@contoso.com → test1@testsecondary.co.in");
  });

  it("classifies duplicate, disabled, missing, and duplicate-source collisions", () => {
    const rows = buildMappingProposals(
      [
        { id: "duplicate-a", userPrincipalName: "dup@contoso.com" },
        { id: "duplicate-b", userPrincipalName: "dup@contoso.com" },
        { id: "disabled", userPrincipalName: "disabled@contoso.com" },
        { id: "missing", userPrincipalName: "missing@contoso.com" },
      ],
      [
        { id: "target-a", userPrincipalName: "disabled@testsecondary.co.in", accountEnabled: false },
        { id: "target-b", userPrincipalName: "missing@testsecondary.co.in", accountEnabled: true },
        { id: "target-c", userPrincipalName: "missing@testsecondary.co.in", accountEnabled: true },
      ],
      "contoso.com",
      "testsecondary.co.in",
    );
    expect(rows.filter((row) => row.collisionCode === "SOURCE_DUPLICATE")).toHaveLength(2);
    expect(rows.find((row) => row.sourceUserId === "disabled")?.collisionCode).toBe("TARGET_DISABLED");
    expect(rows.find((row) => row.sourceUserId === "disabled")?.status).toBe("blocked");
    expect(rows.find((row) => row.sourceUserId === "missing")?.collisionCode).toBe("TARGET_DUPLICATE");
  });

  it("exports an auditable CSV with escaped explanations", () => {
    const csv = mappingsCsv([{ sourceUpn: "test1@contoso.com", targetUpn: "test1@testsecondary.co.in", status: "needs_review", matchMethod: "domain_rewrite", confidence: 92, collisionCode: null, explanation: "Review, then approve" }]);
    expect(csv).toContain("sourceUpn,targetUpn,status,matchMethod,confidence,collisionCode,explanation");
    expect(csv).toContain('"Review, then approve"');
  });
});
