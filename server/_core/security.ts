import type { IncomingHttpHeaders } from "node:http";

/**
 * Identity and authorization must come from verified cookies/tokens and the
 * database-backed user record. These headers are never a trusted identity
 * source and are stripped at the application boundary as defense in depth.
 */
export const UNTRUSTED_IDENTITY_HEADERS = ["x-admin-role", "x-admin-email"] as const;

export function stripUntrustedIdentityHeaders(headers: IncomingHttpHeaders) {
  for (const header of UNTRUSTED_IDENTITY_HEADERS) {
    delete headers[header];
  }
  return headers;
}
