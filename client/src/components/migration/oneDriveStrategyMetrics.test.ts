import { describe, expect, it } from "vitest";
import { completionPercent, overallCompletion } from "./oneDriveStrategyMetrics";

describe("OneDrive strategy completion metrics", () => {
  it("clamps an individual job percentage to 0-100", () => {
    expect(completionPercent({ status: "Running", progress: 135 })).toBe(100);
    expect(completionPercent({ status: "Running", progress: -4 })).toBe(0);
  });

  it("uses item-weighted completion when persisted counts are available", () => {
    expect(overallCompletion([
      { status: "Running", progress: 10, itemsDone: 90, itemsTotal: 100 },
      { status: "Queued", progress: 0, itemsDone: 0, itemsTotal: 300 },
      { status: "Completed", progress: 100, itemsDone: 50, itemsTotal: 50 },
    ])).toBe(23);
  });

  it("falls back to the average percentage when counts are unavailable", () => {
    expect(overallCompletion([
      { status: "Running", progress: 60 },
      { status: "Needs review", progress: 20 },
      { status: "Completed", progress: 100 },
    ])).toBe(40);
  });
});
