# Architecture Overview

## System Context

AllVision is a web application where authenticated users submit prescription data and receive a manual informational report prepared by admins.

## High-Level Modules

1. `Web App (Next.js App Router)`
   - Public/legal pages
   - Auth pages
   - User dashboard and quote request flow
   - Admin panel
2. `Application Services`
   - Auth/session service
   - Quote lifecycle service
   - Report delivery service
   - Audit/GDPR operations service
3. `Data Layer`
   - PostgreSQL
   - Prisma ORM
4. `External Integrations`
   - Email provider (delivery notifications)
   - Payment provider (report purchase)

## Boundaries and Rules

- UI layer cannot access database directly; use server services.
- Admin actions require explicit role checks and audit event emission.
- Legal and disclaimer text is centralized and reused across UI and API responses.
- Payment concerns are isolated from quote-state core to support free MVP launch.

## Domain Model (MVP)

- `User`
- `QuoteRequest`
- `AuditEvent`
- `ReportArtifact` (URL/path metadata, modeled in quote for now)

## Quote Lifecycle

1. User submits prescription -> status `SUBMITTED`.
2. Admin picks up request -> status `IN_REVIEW` (quote in progress).
3. Admin generates report -> status `REPORT_READY`.
4. Report delivered (email/link) -> status `DELIVERED`.
5. Payment captured (if enabled) -> status `PAID`.

## Deployment Shape

- Next.js server runtime
- PostgreSQL managed instance
- Object storage for report files (future)
- CI pipeline enforcing quality gates

## Non-Functional Baseline

- Security: RBAC, rate limit, audit trails.
- Privacy: GDPR workflows and minimization.
- Reliability: transactional updates for quote state transitions.
- Observability: structured logs and request IDs.
