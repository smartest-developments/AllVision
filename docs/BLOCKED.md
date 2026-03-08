# BLOCKED

## 2026-03-06T00:58:00+0100
- Scope: backlog/progress doc updates for `AT-P1-01` after RBAC middleware implementation.
- Blocker: sandbox filesystem denies writes under `plan/` (`EPERM` on `plan/TASK_BACKLOG.md` and `plan/PROGRESS_LOG.md`).
- Impact: code and tests are complete/green, but planning docs could not be synchronized in this run.
- Next step: update `plan/TASK_BACKLOG.md` and `plan/PROGRESS_LOG.md` once write access to `plan/` is restored.

## 2026-03-06T02:12:00+0100
- Scope: prior plan-sync blocker for `AT-P1-01`.
- Resolution: write access to `plan/` restored in this run; backlog/progress/docs synchronized.
- Status: unblocked.
- 2026-03-06T09:21:47+0100: automation sandbox cannot write in this repository (`Operation not permitted`), so backlog/code/doc updates were skipped this run.

## 2026-03-06T13:25:00+0100
- Scope: integration tests for `AT-P1-05B` (`PATCH /api/v1/admin/sourcing-requests/:requestId/status`).
- Blocker: sandbox cannot reach local PostgreSQL (`localhost:5433`) and Docker daemon access is denied (`/Users/simones/.docker/run/docker.sock`), so DB-backed Vitest suites cannot execute.
- Impact: code/docs/backlog updates completed and non-DB gates are green; integration test execution remains pending in a DB-enabled environment.
- Next step: run `npm run test -- tests/integration/admin-sourcing-queue-route.test.ts` once DB connectivity is available.

## 2026-03-06T13:22:42+0100 - Automation blocked
- This run could not safely commit: planning/docs files are read-only and concurrent in-repo edits changed tracked files during execution.

## 2026-03-06T20:31:36+0100
- Automation blocker: repository is read-only in this environment (`Operation not permitted` on file writes), so AT-P1-10 CI workflow and backlog/progress updates could not be applied.

## 2026-03-07T01:40:00+0100
- Scope: commit/push for `AT-AUTO-UI-08` admin queue review-action form increment.
- Blocker: repository contains concurrent pre-existing in-flight changes outside this increment (`app/gdpr/page.tsx`, `src/server/gdpr-delete-requests.ts`, admin GDPR route/page files, and related tests), and full gates are red in current tree (`npm run typecheck` fails in `src/server/gdpr-delete-requests.ts`; `npm run test` fails in `tests/integration/report-ack-route.test.ts` and `tests/integration/prescription-detail-route.test.ts`).
- Impact: new admin review-action UI/route/docs/backlog changes are implemented locally but not safe to commit alongside unrelated drift.
- Next step: stabilize or isolate the unrelated GDPR/report-ack changes, rerun all gates, then commit this increment.
- 2026-03-08T09:56:50+0100 — Blocked `AT-P2-01B` implementation because sandbox denied writes in this repo (`Operation not permitted`). Planned split: `AT-P2-01B1` payment-intent transition (`REPORT_READY -> PAYMENT_PENDING`) then `AT-P2-01B2` settlement transition (`PAYMENT_PENDING -> PAYMENT_SETTLED`).

## 2026-03-08T16:37:05+0100
- Scope: quality-gate validation for `AT-AUTO-UI-10` settlement UI/route increment.
- Blocking gate: `npm run test` fails with pre-existing integration regressions unrelated to this increment.
- Failing suites observed:
  - `tests/integration/admin-review-decision-route.test.ts` (`500` vs expected `303` in form redirect assertion)
  - `tests/integration/admin-sourcing-queue-route.test.ts` (FK constraint on cleanup `prescription.deleteMany`)
  - `tests/integration/report-ack-route.test.ts` (FK constraint on `sourcingRequest.create`)
  - `tests/integration/sourcing-timeline-route-page.test.ts` (missing ack CTA render + FK constraint creating prescription)
- Impact: lint/typecheck/build are green, but full test gate is red so commit/push is skipped this run.
- Next step: stabilize failing integration fixtures/cleanup ordering and timeline expectations, rerun `npm run test`, then commit pending settlement UI changes.
