# Authentication and authorization boundary

Porterline derives identity only from a verified Manus session cookie/bearer token or the database-backed `porterline_local_session` token. The resolved user record supplies the role used by `protectedProcedure` and `adminProcedure`.

The application does **not** trust `x-admin-role`, `x-admin-email`, or any other caller-provided header as identity or authorization. A global ingress middleware removes those headers before routes execute as defense in depth. A security regression test covers the attempted `GLOBAL_ADMIN` spoof.

Tenant connections and migration planning records are owner-scoped by the authenticated `ctx.user.openId`; changing a request header cannot change that owner scope.
