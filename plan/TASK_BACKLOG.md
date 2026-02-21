# Task Backlog

Task size target: 1-3 hours each.
Each task includes DoD and Evidence.

## P0

### Epic A) Identity

1. Implement email/password registration endpoint and persistence.
- DoD: valid account creation, duplicate-email rejection, password hash at rest.
- Evidence: unit tests for validation and integration test for persistence.

2. Implement login/logout with secure session handling.
- DoD: session created, rotated, and revoked with secure cookie settings.
- Evidence: integration tests for login/logout and session invalidation.

3. Enforce RBAC middleware (`USER`, `ADMIN`).
- DoD: admin routes blocked server-side for non-admin users.
- Evidence: integration tests for allow/deny matrix.

### Epic B) Prescription Intake

1. Define and harden prescription schema validation.
- DoD: required optical fields, boundary checks, and EU+CH scope checks are enforced.
- Evidence: unit tests for valid/invalid payload variants.

2. Build prescription intake endpoint + form contract.
- DoD: valid submissions persist and invalid submissions return deterministic error codes.
- Evidence: integration tests for submit and rejection paths.

3. Add sensitive-data access restrictions for prescription records.
- DoD: only owner/admin with role checks can read prescription payload.
- Evidence: authorization integration tests and audit-event assertions.

### Epic C) Sourcing Report Lifecycle

1. Implement `SourcingRequest` entity and transition guard service.
- DoD: only allowed transitions (`SUBMITTED -> IN_REVIEW -> REPORT_READY -> DELIVERED`) are accepted.
- Evidence: unit tests for transition guards.

2. Implement `SourcingStatusEvent` persistence on each transition.
- DoD: every transition writes event record atomically.
- Evidence: integration tests for transition + event creation.

3. Expose user-facing sourcing request status endpoint.
- DoD: users can view only their own request timeline and current state.
- Evidence: integration tests for owner/non-owner access.

### Epic D) Admin Review + Report Upload

1. Build admin queue for pending and in-review sourcing requests.
- DoD: admin-only list and detail retrieval with filtering.
- Evidence: integration tests for admin visibility and filters.

2. Implement admin report artifact upload metadata endpoint.
- DoD: admin can attach report artifact record and change state to `REPORT_READY`.
- Evidence: integration tests and created artifact assertions.

3. Add admin action logging for review decisions and report uploads.
- DoD: all admin review/report actions emit immutable audit events.
- Evidence: integration test asserting audit payload.

### Epic E) Report Delivery

1. Implement secure report retrieval endpoint.
- DoD: only owner can retrieve active artifact link/metadata.
- Evidence: integration tests for authorized and blocked access.

2. Add report delivery acknowledgment endpoint.
- DoD: retrieval/acknowledgment writes delivery audit event.
- Evidence: integration tests for ack state/evidence.

3. Implement email notification stub for report-ready.
- DoD: report-ready transition enqueues mocked email notification.
- Evidence: integration test with mocked provider.

### Epic F) Compliance + Audit

1. Centralize legal disclaimer and informational-only copy blocks.
- DoD: disclaimer rendered on intake, request, and report-delivery surfaces.
- Evidence: UI snapshot tests and copy checklist.

2. Implement GDPR export request flow.
- DoD: authenticated user can submit export request and receive queued status.
- Evidence: integration test and sample JSON contract.

3. Implement GDPR deletion flow (soft-delete then purge/anonymize workflow).
- DoD: request lifecycle logged; protected legal-hold checks supported.
- Evidence: integration tests for lifecycle transitions and audit evidence.

### Epic G) Quality Gates

1. Add CI workflow for lint/typecheck/test/build.
- DoD: pull requests fail if any gate is red.
- Evidence: CI config committed and passing run evidence.

2. Add schema drift and migration checks in CI.
- DoD: migration integrity check fails on drift or missing migrations.
- Evidence: CI step output with green baseline.

3. Add dependency vulnerability scanning.
- DoD: high/critical findings fail CI unless explicitly waived.
- Evidence: CI run artifact for vulnerability scan.

## P1

1. Add optional report fee collection as informational-service payment.
- DoD: payment state is tied to report service product only, not physical goods.
- Evidence: integration tests for payment-required toggle.

2. Build admin SLA dashboard for sourcing request throughput.
- DoD: queue age and delivery time metrics available for admin.
- Evidence: dashboard screenshot and metric tests.

3. Add template library for report generation quality consistency.
- DoD: admins can start from standard report templates.
- Evidence: integration tests for template loading and save behavior.

## P2

1. Add social login option with secure account linking.
- DoD: verified email can link to existing account safely.
- Evidence: integration tests for linking edge cases.

2. Add scoped localization for legal disclaimers by country/language.
- DoD: disclaimer variants selected by locale with legal copy fallback.
- Evidence: tests for locale fallback matrix.

3. Add E2E smoke suite after core lifecycle stabilizes.
- DoD: smoke flow covers signup -> intake -> admin review -> report delivery.
- Evidence: CI E2E run artifact.
