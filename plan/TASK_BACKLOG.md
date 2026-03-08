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

### P1 (18 tasks)

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

10. [AT-P1-09B] Implement admin-reviewed soft-delete execution and purge/anonymize workflow. ✅ DONE
- Size: 2-3h
- DoD: queued deletion requests can be executed with deterministic anonymization/purge steps and immutable audit trace.
- Evidence: `src/server/gdpr-delete-requests.ts`, `app/api/v1/admin/gdpr/delete-requests/route.ts`, `app/api/v1/admin/gdpr/delete-requests/[requestId]/execute/route.ts`, `tests/integration/admin-gdpr-delete-routes.test.ts`, `docs/API_SPEC.md`, `docs/GDPR.md`.

11. [AT-P1-10] Add CI workflow for lint/typecheck/test/build. ✅ DONE
- Size: 1-2h
- DoD: PRs fail on red gate.
- Evidence: `.github/workflows/ci.yml` (Node 22 + Postgres service + prisma migrate + lint/typecheck/test/build gate sequence).

12. [AT-P1-11] Add schema drift and migration checks in CI. ✅ DONE
- Size: 1-2h
- DoD: CI fails on drift or missing migration.
- Evidence: `.github/workflows/ci.yml` (`prisma migrate status` + `prisma migrate diff --exit-code`).

13. [AT-P1-12] Add dependency vulnerability scanning. ✅ DONE
- Size: 1-2h
- DoD: high/critical findings fail CI unless waived.
- Evidence: `.github/workflows/ci.yml` (`npm audit --audit-level=high --omit=dev`).

14. [AT-P1-13] Build authenticated sourcing-request timeline UI surface. ✅ DONE
- Size: 2-3h
- DoD: authenticated users can see request status history cards with timestamps and legal copy.
- Evidence: UI component/page tests plus API consumption contract assertions.

15. [AT-AUTO-UI-07] Add report-delivery acknowledgment UI action on timeline surfaces. ✅ DONE
- Size: 1-2h
- Acceptance: report-ready requests render a deterministic UI action that posts to owner-only delivery-ack endpoint.
- DoD: home + `/timeline` surfaces expose report-ready acknowledgment control and integration coverage validates action wiring.
- Evidence: `app/page.tsx`, `app/timeline/page.tsx`, `tests/integration/sourcing-request-timeline-page.test.ts`, `tests/integration/sourcing-timeline-route-page.test.ts`.

16. [AT-AUTO-UI-08] Add admin queue review-action form for `SUBMITTED -> IN_REVIEW`. ✅ DONE
- Size: 1-2h
- Acceptance: admin queue detail shows a deterministic review-action form for submitted requests and posts to existing status decision route.
- DoD: admins can trigger `IN_REVIEW` transition from request detail without manual API clients; form path preserves current queue filters on return.
- Evidence: `app/admin/sourcing-requests/page.tsx`, `app/api/v1/admin/sourcing-requests/[requestId]/status/route.ts`, `tests/integration/admin-sourcing-queue-page.test.ts`, `tests/integration/admin-review-decision-route.test.ts`.

17. [AT-AUTO-UI-09] Add admin GDPR delete-review queue page and execute action. ✅ DONE
- Size: 1-2h
- Acceptance: admin can view pending `PENDING_REVIEW` delete requests and trigger deterministic execute action from UI.
- DoD: `/admin/gdpr-delete-requests` renders API-backed queue cards, exposes execute forms, and shows clear non-admin access message.
- Evidence: `app/admin/gdpr-delete-requests/page.tsx`, `app/admin/sourcing-requests/page.tsx`, `tests/integration/admin-gdpr-delete-page.test.ts`.

18. [AT-AUTO-UI-10] Add admin queue settlement action for `PAYMENT_PENDING -> PAYMENT_SETTLED`. ✅ DONE
- Size: 1-2h
- Acceptance: admin request detail shows a deterministic settlement action when status is `PAYMENT_PENDING` and returns safely to queue detail context.
- DoD: admin detail renders settlement form posting to the existing settlement endpoint with safe redirect path support; route and page integration tests cover JSON + form-submit contracts.
- Evidence: `app/admin/sourcing-requests/page.tsx`, `app/api/v1/admin/sourcing-requests/[requestId]/report-fee/settle/route.ts`, `tests/integration/admin-sourcing-queue-page.test.ts`, `tests/integration/report-fee-settle-route.test.ts`, `docs/API_SPEC.md`.

### P2 (3 tasks, execution-ready but non-urgent)

1. [AT-P2-01] Add optional report-fee collection for informational service. (split into `AT-P2-01A` + `AT-P2-01B`)
- Size: 2-3h
- DoD: payment state links to report service product only.
- Evidence: integration tests for payment-required toggle.

1a. [AT-P2-01A] Expose report-fee payment state and checkout link metadata on timeline/report payloads. ✅ DONE
- Size: 1-2h
- DoD: owner timeline/report payloads expose deterministic `REPORT_SERVICE` fee metadata and suppress delivery acknowledgment while fee state is pending.
- Evidence: `src/server/sourcing-request-status.ts`, `app/timeline/page.tsx`, `app/api/v1/sourcing-requests/[requestId]/report/route.ts`, `tests/integration/sourcing-request-status.test.ts`, `tests/integration/sourcing-timeline-route-page.test.ts`, `tests/integration/report-route.test.ts`.

1b. [AT-P2-01B] Implement payment intent and settlement transition for report-fee checkout. (split into `AT-P2-01B1` + `AT-P2-01B2`) ✅ DONE
- Size: 1-2h
- DoD: report-fee checkout confirmation transitions `REPORT_READY -> PAYMENT_PENDING -> PAYMENT_SETTLED` before delivery acknowledgement can complete.
- Evidence: integration tests for payment intent lifecycle + settlement webhook/stub.

2. [AT-P2-02] Build admin SLA dashboard for sourcing request throughput. (split into `AT-P2-02A` + `AT-P2-02B`)
- Size: 2-3h
- DoD: queue age and delivery-time metrics visible to admin.
- Evidence: dashboard screenshot + metric tests.

2a. [AT-P2-02A] Add SLA snapshot metrics on admin queue page. ✅ DONE
- Size: 1-2h
- DoD: admin queue page shows queue age and first-review latency metrics scoped to active filters.
- Evidence: `app/admin/sourcing-requests/page.tsx`, `tests/integration/admin-sourcing-queue-page.test.ts`.

2b. [AT-P2-02B] Extend SLA dashboard with delivered-time throughput trend. ✅ DONE
- Size: 1-2h
- DoD: admin SLA view includes median time from submit to report-ready/delivered buckets.
- Evidence: `app/admin/sourcing-requests/page.tsx`, `src/server/admin-sourcing-queue.ts`, `tests/integration/admin-sourcing-queue-page.test.ts`.

3. [AT-P2-03] Add template library for report-generation consistency. (split into `AT-P2-03A` + `AT-P2-03B`)
- Size: 2-3h
- DoD: admin can start from standard report templates.
- Evidence: integration tests for template load/save behavior.

3a. [AT-P2-03A] Add admin report-template load/preview surface on request detail. ✅ DONE
- Size: 1-2h
- DoD: admin request detail exposes standard template choices and deterministic template-body preview tied to URL state.
- Evidence: `app/admin/sourcing-requests/page.tsx`, `tests/integration/admin-sourcing-queue-page.test.ts`.

3b. [AT-P2-03B] Add template save/persist flow for report authoring. ✅ DONE
- Size: 1-2h
- DoD: selected/edited template draft can be persisted and reloaded for the request detail workflow.
- Evidence: `app/admin/sourcing-requests/page.tsx`, `app/api/v1/admin/sourcing-requests/[requestId]/report-template-drafts/route.ts`, `src/server/report-template-drafts.ts`, `tests/integration/admin-sourcing-queue-page.test.ts`, `tests/integration/admin-report-template-draft-route.test.ts`, `docs/API_SPEC.md`.

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
- [AT-AUTO-UI-07] Add report-delivery acknowledgment UI action on home/timeline request cards. ✅ DONE
  - Priority: P1
  - Acceptance: when a request reaches `REPORT_READY`, authenticated owner can submit delivery acknowledgment without manual API invocation.
  - Source signal: `AT-P1-06` shipped owner acknowledgment endpoint, but no UI control exposed the action path.
  - DoD: both timeline surfaces render request-scoped `POST /api/v1/sourcing-requests/:requestId/report/ack` control for `REPORT_READY` items and tests lock action wiring.
  - Evidence: `app/page.tsx`, `app/timeline/page.tsx`, `tests/integration/sourcing-request-timeline-page.test.ts`, `tests/integration/sourcing-timeline-route-page.test.ts`.
- [AT-AUTO-UI-08] Add admin queue review-action form for `SUBMITTED -> IN_REVIEW`. ✅ DONE
  - Priority: P1
  - Acceptance: admin detail surface can trigger the existing review-decision transition route using a deterministic form action.
  - Source signal: admin queue already exposes detail context and status decision API, but no built-in UI action existed to execute review decisions in-place.
  - DoD: submitted requests render a review form posting to admin status route, preserving queue-detail return context and covered by UI + route integration tests.
  - Evidence: `app/admin/sourcing-requests/page.tsx`, `app/api/v1/admin/sourcing-requests/[requestId]/status/route.ts`, `tests/integration/admin-sourcing-queue-page.test.ts`, `tests/integration/admin-review-decision-route.test.ts`.
- [AT-AUTO-UI-09] Add admin GDPR delete-review queue page and execute action. ✅ DONE
  - Priority: P1
  - Acceptance: admin can process queued GDPR deletion requests from in-app UI without manual API clients.
  - Source signal: GDPR deletion moved to queued admin-review contract and needed an operator-facing execution surface.
  - DoD: dedicated admin page lists pending delete requests, includes execute forms, and is covered by integration page tests plus admin API route tests.
  - Evidence: `app/admin/gdpr-delete-requests/page.tsx`, `app/api/v1/admin/gdpr/delete-requests/route.ts`, `app/api/v1/admin/gdpr/delete-requests/[requestId]/execute/route.ts`, `tests/integration/admin-gdpr-delete-page.test.ts`, `tests/integration/admin-gdpr-delete-routes.test.ts`.
- [AT-AUTO-UI-10] Add admin queue settlement action for `PAYMENT_PENDING -> PAYMENT_SETTLED`. ✅ DONE
  - Priority: P1
  - Acceptance: payment-pending request detail exposes deterministic in-app settlement action without requiring manual API clients.
  - Source signal: settlement endpoint existed (`AT-P2-01B2`) but admin queue detail lacked UI execution path and safe form redirect contract.
  - DoD: admin detail renders settlement form for `PAYMENT_PENDING` requests, settlement route supports safe `/admin/sourcing-requests*` form redirects, and integration tests cover both page rendering and redirect contract.
  - Evidence: `app/admin/sourcing-requests/page.tsx`, `app/api/v1/admin/sourcing-requests/[requestId]/report-fee/settle/route.ts`, `tests/integration/admin-sourcing-queue-page.test.ts`, `tests/integration/report-fee-settle-route.test.ts`, `docs/API_SPEC.md`.

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
- [AT-P1-09B] Implement admin-reviewed soft-delete execution and purge/anonymize workflow. ✅ DONE
  - Priority: P1
  - DoD: queued deletion requests can be executed with deterministic anonymization/purge steps and immutable audit trace.
  - Evidence: `src/server/gdpr-delete-requests.ts`, `app/api/v1/gdpr/delete/route.ts`, `app/api/v1/admin/gdpr/delete-requests/route.ts`, `app/api/v1/admin/gdpr/delete-requests/[requestId]/execute/route.ts`, `tests/integration/gdpr-delete-route.test.ts`, `tests/integration/admin-gdpr-delete-routes.test.ts`, `docs/API_SPEC.md`, `docs/GDPR.md`.
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

## RUN_UPDATE_2026-03-07T03:30:00+0100
- [AT-P2-02A] Add SLA snapshot metrics on admin queue page. ✅ DONE
  - Priority: P2
  - DoD: admin queue page shows queue-age and first-review latency metrics scoped to active filters.
  - Evidence: `app/admin/sourcing-requests/page.tsx`, `tests/integration/admin-sourcing-queue-page.test.ts`.
- [AT-P2-02B] Extend SLA dashboard with delivered-time throughput trend. ✅ DONE
  - Priority: P2
  - DoD: admin SLA view includes median time from submit to report-ready/delivered buckets.
  - Evidence target: `app/admin/sourcing-requests/page.tsx`, `src/server/admin-sourcing-queue.ts`, `tests/integration/admin-sourcing-queue-page.test.ts`.

## AUTO_SPLIT_2026-03-08T09:56:50+0100_AT-P2-01B
- [AT-P2-01B] Implement payment intent and settlement transition for report-fee checkout. (split into `AT-P2-01B1` + `AT-P2-01B2`)
- [AT-P2-01B1] Add owner-authenticated report-fee checkout intent endpoint that transitions `REPORT_READY -> PAYMENT_PENDING` with immutable status/audit event. ✅ DONE
  - Priority: P2
  - DoD: owner can start report-fee checkout from home/timeline with owner-authenticated endpoint contract and immutable status/audit evidence.
  - Evidence: `app/api/v1/sourcing-requests/[requestId]/report-fee/checkout/route.ts`, `src/server/report-retrieval.ts`, `app/page.tsx`, `app/timeline/page.tsx`, `tests/integration/report-fee-checkout-route.test.ts`, `tests/integration/sourcing-request-timeline-page.test.ts`, `tests/integration/sourcing-timeline-route-page.test.ts`, `tests/unit/sourcing-request-transition.test.ts`.
- [AT-P2-01B2] Add settlement/webhook stub endpoint that transitions `PAYMENT_PENDING -> PAYMENT_SETTLED` and unlocks delivery acknowledgment. ✅ DONE
  - Priority: P2
  - DoD: deterministic settlement contract updates request state to `PAYMENT_SETTLED`, records immutable audit evidence, and allows report-delivery acknowledgment path.
  - Evidence: `app/api/v1/admin/sourcing-requests/[requestId]/report-fee/settle/route.ts`, `src/server/report-retrieval.ts`, `app/page.tsx`, `app/timeline/page.tsx`, `tests/integration/report-fee-settle-route.test.ts`, `tests/integration/report-ack-route.test.ts`, `tests/integration/sourcing-request-timeline-page.test.ts`, `tests/integration/sourcing-timeline-route-page.test.ts`, `tests/integration/report-route.test.ts`, `docs/API_SPEC.md`.

## RUN_UPDATE_2026-03-08T16:40:47+0100
- [AT-AUTO-UI-11] Add settlement success confirmation banner on admin queue detail. ✅ DONE
  - Priority: P1
  - DoD: settlement form-submit redirects append deterministic `settled=1` marker and admin queue detail renders explicit success banner when marker is present.
  - Evidence: `app/api/v1/admin/sourcing-requests/[requestId]/report-fee/settle/route.ts`, `app/admin/sourcing-requests/page.tsx`, `tests/integration/report-fee-settle-route.test.ts`, `tests/integration/admin-sourcing-queue-page.test.ts`, `docs/API_SPEC.md`.
- [AT-AUTO-BE-04] Add settlement response metadata envelope for admin UI observability. ✅ DONE
  - Priority: P1
  - DoD: settlement JSON response includes deterministic settlement actor and settled-at timestamp fields for admin UI/telemetry correlation.
  - Evidence: `app/api/v1/admin/sourcing-requests/[requestId]/report-fee/settle/route.ts`, `src/server/report-retrieval.ts`, `tests/integration/report-fee-settle-route.test.ts`, `docs/API_SPEC.md`.
- [AT-AUTO-UI-12] Show settlement metadata on admin queue detail success state. ✅ DONE
  - Priority: P1
  - DoD: admin queue detail confirmation state renders `settledAt` and actor metadata from settlement API response with deterministic fallback copy when metadata is unavailable.
  - Evidence: `app/admin/sourcing-requests/page.tsx`, `app/api/v1/admin/sourcing-requests/[requestId]/report-fee/settle/route.ts`, `tests/integration/admin-sourcing-queue-page.test.ts`, `tests/integration/report-fee-settle-route.test.ts`, `docs/API_SPEC.md`.
- [AT-AUTO-BE-05] Include settlement metadata on admin queue detail API payload. ✅ DONE
  - Priority: P1
  - DoD: `GET /api/v1/admin/sourcing-requests/:requestId` includes immutable settlement actor/timestamp fields when request is `PAYMENT_SETTLED|DELIVERED` so admin UI can render settlement evidence without redirect query dependence.
  - Evidence: `app/api/v1/admin/sourcing-requests/[requestId]/route.ts`, `src/server/admin-sourcing-queue.ts`, `tests/integration/admin-sourcing-queue-route.test.ts`, `docs/API_SPEC.md`.
- [AT-AUTO-UI-13] Read settlement metadata from admin detail payload before URL fallback. ✅ DONE
  - Priority: P1
  - DoD: `/admin/sourcing-requests` detail success banner prefers `request.settlement` metadata from detail API and uses query-string `settledBy/settledAt` only as fallback for immediate post-redirect render.
  - Evidence: `app/admin/sourcing-requests/page.tsx`, `tests/integration/admin-sourcing-queue-page.test.ts`.

## RUN_UPDATE_2026-03-08T19:12:00+0100
- [AT-AUTO-BE-05] Include settlement metadata on admin queue detail API payload. ✅ DONE
  - Priority: P1
  - DoD: `GET /api/v1/admin/sourcing-requests/:requestId` includes settlement actor/timestamp metadata only for `PAYMENT_SETTLED|DELIVERED` request states so detail consumers can render immutable settlement evidence without redirect query dependence.
  - Evidence: `app/api/v1/admin/sourcing-requests/[requestId]/route.ts`, `tests/integration/admin-sourcing-queue-settlement-detail.test.ts`, `docs/API_SPEC.md`.
- [AT-AUTO-UI-13] Consume detail-API settlement metadata in admin queue success banner when redirect query params are absent. ✅ DONE
  - Priority: P1
  - DoD: `/admin/sourcing-requests` renders settlement confirmation from `GET /api/v1/admin/sourcing-requests/:requestId` settlement payload as fallback when `settledBy/settledAt` query params are unavailable.
  - Evidence: `app/admin/sourcing-requests/page.tsx`, `tests/integration/admin-sourcing-queue-page.test.ts`.
- [AT-AUTO-BE-06] Include settlement metadata in admin queue list payload for settled states.
  - Priority: P1
  - DoD: `GET /api/v1/admin/sourcing-requests` returns settlement actor/timestamp fields for `PAYMENT_SETTLED|DELIVERED` entries so queue cards can render settlement evidence without loading detail first.
  - Evidence target: `app/api/v1/admin/sourcing-requests/route.ts`, `src/server/admin-sourcing-queue.ts`, `tests/integration/admin-sourcing-queue-route.test.ts`, `docs/API_SPEC.md`.
- [AT-AUTO-UI-14] Show settled-state evidence directly on admin queue cards.
  - Priority: P1
  - DoD: `/admin/sourcing-requests` queue cards render settlement actor/timestamp for `PAYMENT_SETTLED|DELIVERED` rows from list payload metadata and avoid requiring request-detail navigation for first-level settlement confirmation.
  - Evidence target: `app/admin/sourcing-requests/page.tsx`, `tests/integration/admin-sourcing-queue-page.test.ts`, `docs/API_SPEC.md`.
