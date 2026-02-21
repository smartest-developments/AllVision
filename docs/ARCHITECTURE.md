# Architecture Overview

## System Context

AllVision is an account-based web application that converts user prescription input into a manual offshore sourcing report.
The platform provides comparative information only; it does not execute purchases.

## High-Level Modules

1. `Web App (Next.js App Router)`
   - public/legal content
   - identity and session flows
   - prescription intake and sourcing request dashboard
   - admin review workspace
2. `Application Services`
   - identity/session service
   - prescription intake/validation service
   - sourcing request lifecycle service
   - report artifact and delivery service
   - compliance and audit service
3. `Data Layer`
   - PostgreSQL
   - Prisma ORM
4. `External Integrations`
   - email provider (delivery notifications)
   - optional payment provider for informational report fee

## Boundaries and Rules

- UI does not query DB directly; all writes flow through server services.
- Admin actions require role checks and audit-event emission.
- Legal disclaimer content is centralized and reused across surfaces.
- No domain service may include supplier brokering or purchase execution logic.
- Prescription data is treated as sensitive and governed by stricter access controls.

## Domain Model (MVP)

- `User`
- `Session`
- `Prescription`
- `SourcingRequest`
- `SourcingStatusEvent`
- `ReportArtifact`
- `AuditEvent`

## Sourcing Report Lifecycle

1. User submits prescription and sourcing scope -> `SUBMITTED`.
2. Admin starts review -> `IN_REVIEW`.
3. Report prepared and uploaded -> `REPORT_READY`.
4. Report delivered to user -> `DELIVERED`.

## Deployment Shape

- Next.js server runtime
- PostgreSQL managed instance
- object storage for report artifacts (planned)
- CI pipeline enforcing quality gates

## Non-Functional Baseline

- Security: RBAC, rate limits, immutable audit trail.
- Privacy: GDPR workflows and sensitive-data controls.
- Reliability: guarded status transitions with event history.
- Observability: structured logs and request IDs.
