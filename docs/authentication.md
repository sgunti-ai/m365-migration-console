# Tenant-agnostic authentication

The migration console authenticates users independently from Microsoft 365 tenant connections. A user signs in to the application first; source and destination tenants are configured afterward in **Settings → Tenants**. No tenant name, domain, or tenant ID is hardcoded into the login flow.

## Current login

The application includes a local username/password flow with:

- HTTP-only, Secure-in-production, SameSite=Lax session cookies.
- Eight-hour server-side sessions with revocation support.
- Scrypt password hashing with per-password salts.
- Five-failure account lockout for fifteen minutes.
- Login-attempt rate limiting by client IP.
- A bootstrap `admin` account that is marked `mustChangePassword`.
- A strong-password policy for password changes: at least 12 characters with uppercase, lowercase, number, and symbol.
- Protected tenant connection endpoints and workspace ownership based on the authenticated user, not a fixed customer tenant.

For local development, the bootstrap password defaults to the requested temporary value. For production, set `BOOTSTRAP_ADMIN_PASSWORD` as a server secret before starting the application. The production server refuses to start without it. Change the bootstrap password immediately after first login through the password-management flow when enabled for the deployment.

## Tenant connections

Each connection stores a display label, source/destination direction, Microsoft Entra tenant ID, app registration client ID, optional SharePoint site URL, connection status, and an encrypted client-secret ciphertext. Client secrets are encrypted server-side with AES-256-GCM using `CREDENTIAL_ENCRYPTION_KEY`; the plaintext is never returned by the list or create APIs. Production startup requires both `BOOTSTRAP_ADMIN_PASSWORD` and `CREDENTIAL_ENCRYPTION_KEY`.

After saving a connection, an operator can select **Validate with Microsoft Graph**. The server decrypts the secret only in memory, requests an app-only token from the connection's tenant-specific Microsoft identity endpoint, calls Microsoft Graph `/v1.0/organization`, and updates the connection status to `Connected`, `Error`, or `Draft`. A successful response also provides the tenant organization display name to the UI. No credentials are sent to Graph from the browser.

Generate a high-entropy encryption key for a deployment, store it only as a server secret, and keep it stable for the lifetime of the encrypted records. Rotating the key requires a planned decrypt-and-re-encrypt migration; do not replace it casually or existing credentials will become unreadable.

The following endpoints are available:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Create a local session |
| POST | `/api/auth/logout` | Revoke the current local session |
| GET | `/api/auth/me` | Return the current local user |
| POST | `/api/auth/change-password` | Change the local password |
| GET | `/api/workspace/tenant-connections` | List the signed-in user's tenant connections |
| POST | `/api/workspace/tenant-connections` | Add a source or destination tenant connection; accepts `clientSecret` only over the authenticated HTTPS request |
| POST | `/api/workspace/tenant-connections/:id/validate` | Validate one connection against Microsoft Graph and update its status |

The existing Manus OAuth flow remains available for environments that use Manus identity. Azure Entra, SAML, email verification, password-reset email delivery, TOTP, and enterprise group-to-role synchronization remain provider adapters that require deployment-specific credentials and policy decisions.
