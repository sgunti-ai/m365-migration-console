import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ENV } from "./_core/env";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function keyBytes() {
  if (!ENV.credentialEncryptionKey) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be configured before storing tenant credentials");
  return createHash("sha256").update(ENV.credentialEncryptionKey, "utf8").digest();
}

export function encryptCredential(plaintext: string) {
  if (!plaintext) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptCredential(payload: string | null | undefined) {
  if (!payload) return null;
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = payload.split(":");
  if (version !== VERSION || !ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error("Unsupported credential ciphertext format");
  const decipher = createDecipheriv(ALGORITHM, keyBytes(), Buffer.from(ivEncoded, "base64url"));
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, "base64url")), decipher.final()]).toString("utf8");
}

export function hasCredential(payload: string | null | undefined) {
  return Boolean(payload);
}
