# Security Baseline

## Principles

- Secure by default with least privilege.
- Defense in depth for account and request lifecycle.
- Traceability for all admin actions.

## Authentication and Session

- Email + password authentication in MVP.
- Password hashing with Argon2id (or bcrypt with strong work factor if Argon2 unavailable).
- HttpOnly, Secure, SameSite=Lax session cookies.
- Session rotation on login and privilege change.
- Role-based authorization (`USER`, `ADMIN`) on all protected routes.

## Authorization Model

- User can only access own quote requests/reports.
- Admin can access review queue and update request status.
- Server-side checks are mandatory; client checks are non-authoritative.

## Rate Limiting

- Apply rate limit to auth endpoints (login/register/reset).
- Apply rate limit to quote creation and report download endpoints.
- Block abusive IP/session patterns and log security events.

## Audit Trail

Capture immutable audit events for:

- account sign-up/login/logout,
- quote status transitions,
- admin report uploads/edits/delivery actions,
- GDPR operations (export/deletion request lifecycle).

Audit event fields:

- actor ID (nullable for system actions),
- action name,
- target entity and ID,
- timestamp,
- request metadata (IP, user-agent hash, request ID).

## Data Protection Controls

- Encrypt data in transit (TLS required in production).
- Encrypt sensitive storage and backups at rest.
- Use secret management for keys and DSNs.
- Restrict production database network access.

## Application Security Controls

- Input validation with Zod.
- Centralized error handling without leaking internals.
- CSRF protections on state-changing routes.
- Security headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy).

## Dependency and Pipeline Controls

- Pin and review critical dependencies.
- Run lint, typecheck, tests, and build in CI on every PR.
- Add dependency vulnerability scanning in CI.

## Incident Readiness

- Document incident severity, triage, and communication flow.
- Keep audit/event logs for forensic analysis within retention policy.
