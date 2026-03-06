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

### P0 (0 tasks, MVP blockers)

### P1 (13 tasks)

1. [AT-P1-01] Enforce RBAC middleware (`USER`, `ADMIN`). ✅ DONE
- Size: 1-2h
- Acceptance: admin endpoints deterministically return `401` for missing identity and `403` for non-admin role headers.
- DoD: admin routes blocked server-side for non-admin users.
- Evidence: `src/server/request-auth.ts`, `app/api/v1/admin/sourcing-requests/[requestId]/report-artifacts/route.ts`, `tests/integration/admin-report-artifact-route-auth.test.ts`.

2. [AT-P1-02] Add sensitive-data access restrictions for prescription records. ✅ DONE
- Size: 1-2h
- DoD: only owner/admin can read prescription payload.
- Evidence: `app/api/v1/prescriptions/[prescriptionId]/route.ts`, `src/server/prescriptions.ts`, `src/server/request-auth.ts`, `tests/integration/prescription-detail-route.test.ts`.

3. [AT-P1-03] Expose user-facing sourcing request status endpoint. ✅ DONE
- Size: 1-2h
- DoD: users view only own request timeline and current state.
- Evidence: `app/api/v1/sourcing-requests/route.ts`, `src/server/sourcing-request-status.ts`, `tests/integration/sourcing-request-status.test.ts`, `tests/integration/sourcing-request-status-route.test.ts`.

4. [AT-P1-04] Build admin queue for pending and in-review sourcing requests. (split into `AT-P1-04A` + `AT-P1-04B`)
- Size: 2-3h
- DoD: admin-only list/detail retrieval with basic filters.
- Evidence: integration tests for visibility and filters.

4a. [AT-P1-04A] Add admin queue API list/detail contract with filter params. ✅ DONE
- Priority: P1
- Size: 1-2h
- DoD: admin-only queue endpoints return deterministic list/detail payloads with validated filter inputs.
- Evidence: `app/api/v1/admin/sourcing-requests/route.ts`, `app/api/v1/admin/sourcing-requests/[requestId]/route.ts`, `src/server/admin-sourcing-queue.ts`, `tests/integration/admin-sourcing-queue-route.test.ts`, `docs/API_SPEC.md`.

4b. [AT-P1-04B] Add admin queue UI surface bound to API list/detail contract. ✅ DONE
- Priority: P1
- Size: 1-2h
- DoD: admin-only queue page renders pending/in-review requests with filter controls backed by API responses.
- Evidence: `app/admin/sourcing-requests/page.tsx`, `tests/integration/admin-sourcing-queue-page.test.ts`.

5. [AT-P1-05] Add admin action logging for review decisions and report uploads. ✅ DONE
- Size: 1-2h
- DoD: admin review/upload actions emit immutable audit events.
- Evidence: `src/server/report-artifacts.ts`, `src/server/admin-review-decisions.ts`, `app/api/v1/admin/sourcing-requests/[requestId]/route.ts`, `tests/integration/admin-report-artifact.test.ts`, `tests/integration/admin-sourcing-queue-route.test.ts`.

6. [AT-P1-06] Add report delivery acknowledgment endpoint. ✅ DONE
- Size: 1-2h
- DoD: retrieval acknowledgment writes delivery audit evidence.
- Evidence: `src/server/report-retrieval.ts`, `app/api/v1/sourcing-requests/[requestId]/report/ack/route.ts`, `tests/integration/report-ack-route.test.ts`, `docs/API_SPEC.md`.

7. [AT-P1-07] Centralize legal disclaimer and informational-only copy blocks. ✅ DONE
- Size: 1-2h
- DoD: disclaimer appears on intake, request, and report-delivery surfaces.
- Evidence: `src/legal/disclaimers.ts`, `app/page.tsx`, `app/api/v1/prescriptions/route.ts`, `app/api/v1/sourcing-requests/[requestId]/report/route.ts`, `tests/unit/legal-disclaimers.test.ts`

8. [AT-P1-08] Implement GDPR export request flow. ✅ DONE
- Size: 2-3h
- DoD: authenticated export request is queued and tracked.
- Evidence: `app/api/v1/gdpr/export/route.ts`, `src/server/gdpr-export-requests.ts`, `tests/integration/gdpr-export-route.test.ts`, `docs/API_SPEC.md`.

9. [AT-P1-09] Implement GDPR deletion flow (soft-delete then purge/anonymize workflow). ✅ DONE
- Size: 2-3h
- DoD: deletion lifecycle recorded with legal-hold checks.
- Evidence: `app/api/v1/gdpr/delete/route.ts`, `src/server/gdpr-delete-requests.ts`, `tests/integration/gdpr-delete-route.test.ts`, `docs/API_SPEC.md`.

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

13. [AT-P1-13] Build authenticated sourcing-request timeline UI surface. ✅ DONE
- Size: 2-3h
- DoD: authenticated users can see request status history cards with timestamps and legal copy.
- Evidence: UI component/page tests plus API consumption contract assertions.

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
- [AT-P0-07] Persist status-change audit trail (`SourcingStatusEvent`) and trigger report-ready email notification stub.
  - Evidence: integration test asserts status-event persistence and `REPORT_READY_EMAIL_ENQUEUED` audit marker.
- [AT-P1-07] Centralize legal disclaimer and informational-only copy blocks.
  - Evidence: shared legal copy module + request/intake/report-delivery wiring with unit coverage.
- [AT-P1-01] Enforce RBAC middleware (`USER`, `ADMIN`).
  - Evidence: `src/server/request-auth.ts`, `app/api/v1/admin/sourcing-requests/[requestId]/report-artifacts/route.ts`, `tests/integration/admin-report-artifact-route-auth.test.ts`.
- [AT-P1-03] Expose user-facing sourcing request status endpoint.
  - Evidence: owner-only route/service wired with integration coverage for unauthorized and cross-user access.
- [AT-P1-13] Build authenticated sourcing-request timeline UI surface.
  - Evidence: `app/page.tsx`, `tests/integration/sourcing-request-timeline-page.test.ts`.
- [AT-P1-04B] Add admin queue UI surface bound to API list/detail contract.
  - Evidence: `app/admin/sourcing-requests/page.tsx`, `tests/integration/admin-sourcing-queue-page.test.ts`.
- [AT-AUTO-UI-01] Add dedicated authenticated timeline route with request detail deep-linking.
  - Evidence: `app/timeline/page.tsx`, `app/page.tsx`, `tests/integration/sourcing-timeline-route-page.test.ts`.
- [AT-AUTO-UI-02] Add authenticated navigation entry and empty-state UX polish for timeline deep-linking.
  - Evidence: `app/page.tsx`, `app/timeline/page.tsx`, `tests/integration/sourcing-request-timeline-page.test.ts`, `tests/integration/sourcing-timeline-route-page.test.ts`.

## AUTO_DISCOVERED

- [AT-AUTO-UI-01] Add dedicated authenticated timeline route with request detail deep-linking. ✅ DONE
  - Priority: P1
  - Source signal: timeline UI now lives on root page and needs dedicated navigation/URL semantics as auth surfaces expand.
  - DoD: `/timeline` route lists owner requests and supports `requestId` focus state without exposing other users' data.
  - Evidence target: `app/timeline/page.tsx`, `app/page.tsx`, `tests/integration/sourcing-timeline-route-page.test.ts`.
- [AT-AUTO-BE-01] Replace `x-user-id` header auth shim with session-derived identity for sourcing status APIs. ✅ DONE
  - Priority: P1
  - Acceptance: timeline and status APIs ignore caller-supplied identity headers and resolve user from session cookie only.
  - Source signal: current UI/API integration depends on manual user-id input and header-based identity.
  - DoD: sourcing-request APIs resolve authenticated user from session cookie and reject identity spoofing.
  - Evidence target: `src/server/request-auth.ts`, `app/api/v1/sourcing-requests/route.ts`, `app/api/v1/sourcing-requests/[requestId]/report/route.ts`, `app/api/v1/prescriptions/route.ts`, `tests/integration/sourcing-request-status-route.test.ts`, `tests/integration/admin-report-artifact-route-auth.test.ts`.
- [AT-AUTO-UI-02] Add authenticated navigation entry and empty-state UX polish for timeline deep-linking. ✅ DONE
  - Priority: P1
  - Acceptance: authenticated users can always reach timeline from shell navigation and recover from invalid `requestId` focus with one click.
  - Source signal: `/timeline` now exists but remains disconnected from authenticated shell and lacks error recovery affordances.
  - DoD: authenticated surfaces link to `/timeline`, request-focus miss state includes reset CTA, and component tests cover navigation + reset behavior.
  - Evidence target: app-shell/nav tests plus timeline page interaction coverage.
- [AT-AUTO-UI-03] Replace manual `userId` query input with session-aware timeline loading UX. ✅ DONE
  - Priority: P1
  - Acceptance: home/timeline pages load owner-scoped data from authenticated session without requiring `?userId=` query entry.
  - Source signal: UI still requires manual user-id entry despite backend now resolving identity from session cookie.
  - DoD: timeline pages remove manual user-id form dependency and keep request deep-link/focus behavior.
  - Evidence target: `app/page.tsx`, `app/timeline/page.tsx`, `src/server/page-auth.ts`, integration tests for session-driven timeline rendering.
- [AT-AUTO-BE-02] Consolidate session identity resolution for API and server-rendered pages. ✅ DONE
  - Priority: P1
  - Acceptance: API middleware and page/session resolver share one canonical active-session lookup helper.
  - Source signal: session lookup logic is currently duplicated between request middleware and page SSR helper.
  - DoD: one shared resolver enforces expiry/revocation semantics across API routes and server-rendered UI.
  - Evidence target: `src/server/session-identity.ts`, `src/server/request-auth.ts`, `src/server/page-auth.ts`, `tests/integration/session-identity-resolver.test.ts`.
- [AT-AUTO-UI-04] Add signed-out recovery CTA on home/timeline timeline surfaces. ✅ DONE
  - Priority: P1
  - Acceptance: signed-out guidance includes a clear path to authenticate and return to timeline context.
  - Source signal: session-aware timeline views now hide data when signed out but provide no direct auth CTA.
  - DoD: signed-out states include authentication action links and integration tests cover CTA rendering.
  - Evidence target: `app/page.tsx`, `app/timeline/page.tsx`, `tests/integration/sourcing-request-timeline-page.test.ts`, `tests/integration/sourcing-timeline-route-page.test.ts`.

- [AT-AUTO-UI-05] Add prescription detail UI panel with owner/admin auth-aware access messaging. ✅ DONE
  - Priority: P1
  - Acceptance: authenticated users can open a prescription detail panel and receive deterministic access guidance for missing/forbidden records.
  - Source signal: `AT-P1-02` now exposes secure prescription detail API, but no UI surface consumes or explains this payload yet.
  - DoD: at least one authenticated UI route renders normalized prescription details and handles `401|403|404` responses with user-safe messaging.
  - Evidence: `app/timeline/page.tsx`, `src/server/page-auth.ts`, `tests/integration/sourcing-timeline-route-page.test.ts`.

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

## AUTO_SPLIT_2026-03-06_AT-P1-05
- [AT-P1-05] Add admin action logging for review decisions and report uploads. (split into `AT-P1-05A` + `AT-P1-05B`)
- [AT-P1-05A] Persist immutable `REPORT_ARTIFACT_UPLOADED` audit event on admin report upload/status move. ✅ DONE
  - DoD: report-artifact upload writes dedicated audit row with actor/request/artifact context and transition metadata.
  - Evidence: `src/server/report-artifacts.ts`, `tests/integration/admin-report-artifact.test.ts`.
- [AT-P1-05B] Add immutable audit event on explicit admin review decision transitions. ✅ DONE
  - DoD: admin review decision route writes deterministic audit event payload per transition.
  - Evidence: `src/server/admin-review-decisions.ts`, `app/api/v1/admin/sourcing-requests/[requestId]/route.ts`, `tests/integration/admin-sourcing-queue-route.test.ts`.

- [AT-AUTO-BE-03] Harden report-ack delivery transition for concurrent idempotency. ✅ DONE
  - Priority: P1
  - Acceptance: repeated/concurrent `POST /api/v1/sourcing-requests/:requestId/report/ack` calls never create duplicate `DELIVERED` status events or duplicate `REPORT_DELIVERY_ACKNOWLEDGED` audit markers.
  - Source signal: delivery acknowledgment transition previously updated status/events without a conditional state transition guard.
  - DoD: delivery acknowledgment transition uses conditional `REPORT_READY -> DELIVERED` update semantics and integration tests assert idempotent repeated-ack behavior.
  - Evidence: `src/server/report-retrieval.ts`, `tests/integration/report-ack-route.test.ts`.

## RUN_UPDATE_2026-03-06T16:23:58+0100
- [AT-P1-09] Implement GDPR deletion flow (soft-delete then purge/anonymize workflow). (split into `AT-P1-09A` + `AT-P1-09B`)
- [AT-P1-09A] Add authenticated GDPR deletion-request endpoint with legal-hold gate + immutable audit evidence. ✅ DONE
  - Priority: P1
  - DoD: `POST /api/v1/gdpr/delete` returns `202` for queued requests, `401` for unauthenticated calls, and `409 LEGAL_HOLD_ACTIVE` when in-flight sourcing states require retention.
  - Evidence: `app/api/v1/gdpr/delete/route.ts`, `src/server/gdpr-delete-requests.ts`, `tests/integration/gdpr-delete-route.test.ts`, `docs/API_SPEC.md`.
- [AT-P1-09B] Implement admin-reviewed soft-delete execution and purge/anonymize workflow.
  - Priority: P1
  - DoD: queued deletion requests can be executed with deterministic anonymization/purge steps and immutable audit trace.
  - Evidence target: server workflow module + integration tests + API/docs updates.
- [AT-AUTO-UI-06] Add authenticated GDPR self-service page for export/deletion request status and legal-hold messaging.
  - Priority: P1
  - DoD: authenticated user can submit GDPR export/deletion requests and see deterministic status/error messaging without manual API invocation.
  - Evidence target: `app/gdpr/page.tsx`, integration page tests, API contract references.

## RUN_UPDATE_2026-03-06T16:27:30+0100_UI
- [AT-AUTO-UI-06] Add authenticated GDPR self-service page for export/deletion request status and legal-hold messaging. (split into `AT-AUTO-UI-06A` + `AT-AUTO-UI-06B`)
- [AT-AUTO-UI-06A] Add authenticated GDPR action panel on home timeline surface with export/deletion submit controls. ✅ DONE
  - Priority: P1
  - DoD: authenticated home UI renders deterministic GDPR action controls targeting export/deletion request APIs; signed-out state shows explicit auth CTA copy.
  - Evidence: `app/page.tsx`, `tests/integration/sourcing-request-timeline-page.test.ts`.
- [AT-AUTO-UI-06B] Add dedicated /gdpr status page with request history + legal-hold guidance copy. ✅ DONE
  - Priority: P1
  - DoD: authenticated users can view GDPR request history and legal-hold guidance without leaving timeline context.
  - Evidence: app/gdpr/page.tsx, src/server/gdpr-request-history.ts, tests/integration/gdpr-page.test.ts, tests/integration/sourcing-request-timeline-page.test.ts.

## RUN_UPDATE_2026-03-06T17:22:41+0100
- [AT-AUTO-UI-06B] Add dedicated `/gdpr` status page with request history + legal-hold guidance. ✅ DONE
  - Priority: P1
  - DoD: authenticated UI route renders GDPR export/deletion request history with signed-out fallback guidance and explicit legal-hold contract note (`409 GDPR_DELETE_LEGAL_HOLD`).
  - Evidence: `app/gdpr/page.tsx`, `src/server/gdpr-request-history.ts`, `tests/integration/gdpr-page.test.ts`, `tests/integration/sourcing-request-timeline-page.test.ts`, `plan/PROGRESS_LOG.md`, `docs/GDPR.md`.
