# Task Backlog

Task sizing target: each item fits in 1-3 hours.
Definition style: each task includes clear DoD and Evidence.

## P0

### Epic A) Identity & Session

1. Implement email/password registration endpoint and persistence.
- DoD: valid account creation, duplicate-email rejection, password hash at rest.
- Evidence: unit tests for validation + integration test for persistence path.

2. Implement login/logout with secure session cookie.
- DoD: authenticated session creation and invalidation with secure cookie flags.
- Evidence: integration tests for auth flow and cookie behavior.

3. Add RBAC middleware for `USER` and `ADMIN` routes.
- DoD: admin routes blocked for non-admin users server-side.
- Evidence: integration tests for allow/deny matrix.

### Epic B) Prescription Intake + Validation

1. Define prescription schema and shared validator package.
- DoD: strict schema for required optical fields and constraints.
- Evidence: unit tests for valid/invalid payload examples.

2. Build user intake form and submit API contract.
- DoD: form submits normalized payload; server rejects invalid data.
- Evidence: integration test for request submission and stored payload shape.

3. Add EU+CH country scope validation.
- DoD: non-EU/non-CH requests rejected with clear error code.
- Evidence: unit tests for country whitelist.

### Epic C) Quote Lifecycle + Admin Review

1. Create quote request entity and state transition service.
- DoD: allowed transitions enforced (`SUBMITTED` -> `IN_REVIEW` -> `REPORT_READY` -> `DELIVERED` -> `PAID`).
- Evidence: unit tests for transition guards.

2. Build admin quote queue endpoint/page (manual review).
- DoD: admin can list and open pending requests only with auth.
- Evidence: integration tests + screenshot evidence in PR.

3. Implement admin status update action with audit event.
- DoD: every status change writes an audit event atomically.
- Evidence: integration tests asserting event creation.

### Epic D) Report Delivery (download/link/email stub)

1. Add report metadata model and attachment endpoint.
- DoD: admin can attach report URL/token to quote.
- Evidence: integration test for endpoint + persisted metadata.

2. Build user report retrieval endpoint with authorization checks.
- DoD: only owner can retrieve report link/download details.
- Evidence: integration tests for owner vs non-owner access.

3. Add email notification stub for report-ready event.
- DoD: notification job/log entry created when report becomes ready.
- Evidence: integration test with mocked provider.

### Epic F) Compliance: disclaimers, GDPR ops, audit events

1. Centralize legal disclaimer content and render in key surfaces.
- DoD: disclaimer appears on intake, checkout, and report pages.
- Evidence: UI tests/snapshots and copy review checklist.

2. Implement GDPR export request endpoint + worker stub.
- DoD: authenticated user can request export; request logged and queued.
- Evidence: integration test and sample exported JSON contract.

3. Implement GDPR deletion request workflow (soft-delete first).
- DoD: request recorded, account soft-deleted, audit event emitted.
- Evidence: integration tests for deletion lifecycle.

### Epic G) Quality gates + CI

1. Add CI workflow for lint/typecheck/test/build on pull requests.
- DoD: PR pipeline fails on any red gate.
- Evidence: CI config committed + passing run link.

2. Enforce branch protections and required checks policy.
- DoD: merge requires green checks and at least one review.
- Evidence: repository settings screenshot/record.

3. Add dependency vulnerability scan to CI.
- DoD: critical/high vulnerabilities fail pipeline (tunable).
- Evidence: CI run output with security scan step.

## P1

### Epic E) Payments (as info product) - may be deferred if MVP free

1. Integrate checkout session creation for report service fee.
- DoD: quote links to provider checkout session with idempotency key.
- Evidence: integration test with provider mock.

2. Implement payment webhook handler with signature verification.
- DoD: verified events update quote payment status safely.
- Evidence: integration tests for valid/invalid signatures.

3. Add payment-required gate before report download (toggleable).
- DoD: when enabled, unpaid report access blocked with clear UX state.
- Evidence: integration test for paid/unpaid paths.

## P2

1. Add observability dashboard for lifecycle metrics.
- DoD: baseline metrics for request volume, turnaround time, delivery rate.
- Evidence: dashboard export/screenshot + instrumentation tests.

2. Add social login (optional).
- DoD: OAuth login links to existing account by verified email.
- Evidence: integration tests for account linking edge cases.

3. Prepare E2E suite for core happy path (after core flow stable).
- DoD: CI smoke E2E for signup -> submit -> admin review -> report delivery.
- Evidence: recorded run artifact and green CI job.
