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

Each connection stores only non-secret configuration metadata: a display label, source/destination direction, Microsoft Entra tenant ID, optional app registration client ID, optional SharePoint site URL, and connection status. Client secrets and certificates are intentionally not stored in the browser or in this table. They should be supplied through server-side project secrets or a future encrypted credential vault adapter.

The following endpoints are available:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Create a local session |
| POST | `/api/auth/logout` | Revoke the current local session |
| GET | `/api/auth/me` | Return the current local user |
| POST | `/api/auth/change-password` | Change the local password |
| GET | `/api/workspace/tenant-connections` | List the signed-in user's tenant connections |
| POST | `/api/workspace/tenant-connections` | Add a source or destination tenant connection |

The existing Manus OAuth flow remains available for environments that use Manus identity. Azure Entra, SAML, email verification, password-reset email delivery, TOTP, and enterprise group-to-role synchronization remain provider adapters that require deployment-specific credentials and policy decisions.
