# Security Baseline

## Principles

- Secure by default and least privilege.
- Defense in depth for identity, data handling, and admin operations.
- Full traceability of user/admin actions affecting sourcing reports.

## Authentication and Session

- Email/password authentication in MVP.
- Password hashing with Argon2id (fallback bcrypt with strong cost only if needed).
- HttpOnly, Secure, SameSite=Lax session cookies.
- Server-side session invalidation and rotation on login/privilege changes.
- RBAC (`USER`, `ADMIN`) across protected routes and admin workflows.

## Authorization Model

- Users can access only their own prescriptions, sourcing requests, and report artifacts.
- Admins can review and update sourcing request lifecycle.
- Authorization checks are server-enforced on every sensitive action.

## Rate Limiting

- Strict limits on registration/login/reset endpoints.
- Limits on prescription intake and report retrieval endpoints.
- Abuse detection for repeated failed auth and high-frequency request patterns.

## Audit Trail

Capture immutable audit records for:

- identity/session events,
- sourcing status transitions,
- report uploads/edits/delivery actions,
- GDPR operations (export/deletion requests and completion).

Audit fields:

- actor ID (nullable for system),
- action,
- entity type/ID,
- timestamp,
- request metadata (request ID, IP hash, user-agent hash).

## Medical Boundary Controls

- Product and API copy must consistently state informational-only scope.
- No component may output medical recommendations or treatment guidance.
- Validation and workflow logic handle prescription as input data only, not clinical interpretation.
- Security reviews must flag wording that implies medical advice or supplier endorsement.

## Data Protection Controls

- TLS in transit and encryption at rest for primary storage/backups.
- Secret management for credentials/keys.
- Restricted network access to production data stores.
- Principle of least privilege for admin and operational accounts.

## Application Security Controls

- Schema validation (Zod) for all input.
- Centralized error handling with non-sensitive client errors.
- CSRF protection for state-changing requests.
- Security headers: CSP, HSTS, X-Content-Type-Options, Referrer-Policy.

## SDLC Controls

- Lint/typecheck/test/build required in CI for each PR.
- Dependency and vulnerability scanning in CI.
- Security-sensitive changes require reviewer sign-off.
