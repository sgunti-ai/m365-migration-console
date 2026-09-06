import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

describe("migration.graph.health", () => {
  it("reports both tenants as not configured without exposing credentials", async () => {
    const ctx: TrpcContext = {
      user: {
        id: 1,
        openId: "graph-test-user",
        email: "graph@example.com",
        name: "Graph Test User",
        loginMethod: "test",
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };

    const result = await appRouter.createCaller(ctx).migration.graph.health();

    expect(result).toHaveLength(2);
    expect(result.every(item => item.status === "not_configured")).toBe(true);
    expect(result.every(item => item.detail.includes("tenant ID"))).toBe(true);
    expect(result.some(item => item.detail.includes("client secret"))).toBe(true);
  });
});
