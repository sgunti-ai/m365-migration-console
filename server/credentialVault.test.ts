import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential } from "./credentialVault";

describe("credential vault", () => {
  it("encrypts secrets with authenticated ciphertext and decrypts them", () => {
    const secret = "super-secret-value-2026";
    const ciphertext = encryptCredential(secret);
    expect(ciphertext).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(ciphertext).not.toContain(secret);
    expect(decryptCredential(ciphertext)).toBe(secret);
  });

  it("uses a fresh IV for each encryption", () => {
    const first = encryptCredential("same-secret");
    const second = encryptCredential("same-secret");
    expect(first).not.toBe(second);
  });
});
