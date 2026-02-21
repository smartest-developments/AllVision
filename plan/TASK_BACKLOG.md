# Task Backlog

## STRATEGIC_EPICS

- Epic A) Identity
Goal: reliable account access with secure sessions for users and admins.
Completion signal: registration/login/logout plus RBAC checks pass in integration tests.

- Epic B) Prescription Intake
Goal: capture valid prescription input safely and persist it for sourcing analysis.
Completion signal: schema validation and intake persistence pass with owner-only access rules.

- Epic C) Sourcing Report Lifecycle
Goal: move sourcing requests through controlled states with traceable history.
Completion signal: transition guard + status-event records are enforced and test-covered.

- Epic D) Admin Review + Report Upload
Goal: enable admins to review requests and attach report artifacts.
Completion signal: admin queue and report upload actions work with authorization and auditability.

- Epic E) Report Delivery
Goal: deliver sourcing report artifacts securely to the requesting user.
Completion signal: authorized retrieval path and one notification/acknowledgment path are operational.

- Epic F) Compliance + Audit
Goal: enforce legal positioning, GDPR operations, and immutable action traces.
Completion signal: disclaimers are surfaced and GDPR export/deletion flows are test-covered.

- Epic G) Quality Gates
Goal: keep repository continuously green and deployment-safe.
Completion signal: CI blocks merges on lint/typecheck/test/build and migration/security checks.

## ACTIVE_TASKS

### P0 (3 tasks, MVP blockers)

1. [AT-P0-07] Persist status-change audit trail (`SourcingStatusEvent`) and trigger report-ready email notification stub (merged from lifecycle + delivery tasks).
- Size: 2-3h
- DoD: every status change writes event record; report-ready transition enqueues mocked email notification.
- Evidence: integration tests for event creation and notification trigger.

### P1 (12 tasks)

1. [AT-P1-01] Enforce RBAC middleware (`USER`, `ADMIN`).
- Size: 1-2h
- DoD: admin routes blocked server-side for non-admin users.
- Evidence: integration tests for allow/deny matrix.

2. [AT-P1-02] Add sensitive-data access restrictions for prescription records.
- Size: 1-2h
- DoD: only owner/admin can read prescription payload.
- Evidence: authorization integration tests and audit assertions.

3. [AT-P1-03] Expose user-facing sourcing request status endpoint.
- Size: 1-2h
- DoD: users view only own request timeline and current state.
- Evidence: integration tests for owner/non-owner access.

4. [AT-P1-04] Build admin queue for pending and in-review sourcing requests.
- Size: 2-3h
- DoD: admin-only list/detail retrieval with basic filters.
- Evidence: integration tests for visibility and filters.

5. [AT-P1-05] Add admin action logging for review decisions and report uploads.
- Size: 1-2h
- DoD: admin review/upload actions emit immutable audit events.
- Evidence: integration test asserting audit payload.

6. [AT-P1-06] Add report delivery acknowledgment endpoint.
- Size: 1-2h
- DoD: retrieval acknowledgment writes delivery audit evidence.
- Evidence: integration tests for ack behavior.

7. [AT-P1-07] Centralize legal disclaimer and informational-only copy blocks.
- Size: 1-2h
- DoD: disclaimer appears on intake, request, and report-delivery surfaces.
- Evidence: snapshot/copy checklist in tests.

8. [AT-P1-08] Implement GDPR export request flow.
- Size: 2-3h
- DoD: authenticated export request is queued and tracked.
- Evidence: integration test and sample export contract.

9. [AT-P1-09] Implement GDPR deletion flow (soft-delete then purge/anonymize workflow).
- Size: 2-3h
- DoD: deletion lifecycle recorded with legal-hold checks.
- Evidence: integration tests for lifecycle and audit evidence.

10. [AT-P1-10] Add CI workflow for lint/typecheck/test/build.
- Size: 1-2h
- DoD: PRs fail on red gate.
- Evidence: CI config + passing run artifact.

11. [AT-P1-11] Add schema drift and migration checks in CI.
- Size: 1-2h
- DoD: CI fails on drift or missing migration.
- Evidence: CI step output.

12. [AT-P1-12] Add dependency vulnerability scanning.
- Size: 1-2h
- DoD: high/critical findings fail CI unless waived.
- Evidence: CI run artifact.

### P2 (3 tasks, execution-ready but non-urgent)

1. [AT-P2-01] Add optional report-fee collection for informational service.
- Size: 2-3h
- DoD: payment state links to report service product only.
- Evidence: integration tests for payment-required toggle.

2. [AT-P2-02] Build admin SLA dashboard for sourcing request throughput.
- Size: 2-3h
- DoD: queue age and delivery-time metrics visible to admin.
- Evidence: dashboard screenshot + metric tests.

3. [AT-P2-03] Add template library for report-generation consistency.
- Size: 2-3h
- DoD: admin can start from standard report templates.
- Evidence: integration tests for template load/save behavior.

## COMPLETED

- [AT-P0-06] Implement secure report retrieval endpoint for request owner.
  - Evidence: integration tests for authorized and forbidden access.
- [AT-P0-01] Implement email/password registration + login/logout with secure session handling (merged from Identity tasks).
  - Evidence: integration tests for register/login/logout flow and session invalidation.
- [AT-P0-02] Define and harden prescription schema validation.
  - Evidence: unit tests for valid/invalid payload matrix with EU+CH scope checks.
- [AT-P0-03] Build prescription intake endpoint + form contract with persistence.
  - Evidence: integration tests for submit + reject + persistence path.
- [AT-P0-04] Implement `SourcingRequest` transition guard service (`SUBMITTED -> IN_REVIEW -> REPORT_READY`).
  - Evidence: unit tests for transition rules.
- [AT-P0-05] Implement admin report artifact upload metadata endpoint and status move to `REPORT_READY`.
  - Evidence: integration test asserting status + artifact persistence.

## AUTO_DISCOVERED

- Placeholder for automation-generated tasks discovered during implementation/testing.
- Rules for future entries: must include source signal, proposed priority, DoD, and evidence target before promotion to ACTIVE_TASKS.

## TECH_DEBT

- TD-01: CI hardening follow-up tracked by [AT-P1-11] and [AT-P1-12] to reduce migration/security regressions.
- TD-02: Operational visibility maturity tracked by [AT-P2-02] (useful but not MVP-blocking).
- TD-03: Report authoring consistency improvements tracked by [AT-P2-03].

## RISK_ITEMS

- R-01 Legal misclassification risk (service perceived as seller/broker).
Mitigation refs: [AT-P1-07], [AT-P1-05].

- R-02 Sensitive prescription data exposure risk.
Mitigation refs: [AT-P1-02], [AT-P1-08], [AT-P1-09], [AT-P0-07].

- R-03 Delivery reliability risk (report readiness without successful user delivery signal).
Mitigation refs: [AT-P0-05], [AT-P0-06], [AT-P0-07], [AT-P1-06].

## PARKED

- PK-01: Add social login option with secure account linking (from prior P2).
- PK-02: Add scoped localization for legal disclaimers by country/language (from prior P2).
- PK-03: Add E2E smoke suite after core lifecycle stabilizes (from prior P2, intentionally deferred until core flow is stable).
