import { describe, expect, it } from "vitest";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./localAuth";

describe("local authentication", () => {
  it("hashes and verifies passwords without storing plaintext", async () => {
    const password = "Temporary-Admin-2026!";
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^scrypt\$/);
    expect(hash).not.toContain(password);
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("enforces the strong password policy for changed passwords", () => {
    expect(validatePasswordPolicy("password")).toBe(false);
    expect(validatePasswordPolicy("short-A1!")).toBe(false);
    expect(validatePasswordPolicy("Temporary-Admin-2026!")).toBe(true);
  });
});
