import { describe, expect, it } from "vitest";
import { isThrottlingIncident } from "./migrationIncidentRules";

describe("migration incident rules", () => {
  it("classifies provider throttling signals from event types and payloads", () => {
    expect(isThrottlingIncident("sharepoint.throttled", { retryAfter: "30" })).toBe(true);
    expect(isThrottlingIncident("sharepoint.progress", { message: "HTTP 429 from provider" })).toBe(true);
    expect(isThrottlingIncident("sharepoint.progress", { message: "package uploaded" })).toBe(false);
  });
});
