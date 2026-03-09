# API Specification (MVP Draft)

Status: contract draft. Unimplemented endpoints may return `501 Not Implemented` during bootstrap.

## Conventions

- Base path: `/api/v1`
- Auth: session cookie
- Content type: `application/json`
- Error shape:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable"
  }
}
```

## Legal Contract

All API surfaces must maintain these constraints:

- informational service only,
- no sale of medical devices,
- no brokering or transaction execution,
- no medical advice,
- user is responsible for final purchase decisions.

## Auth

### `POST /api/v1/auth/register`

- Purpose: create account with email/password.
- Responses: `201`, `400`, `409`, `429`, `501`.

### `POST /api/v1/auth/login`

- Purpose: create authenticated session.
- Responses: `200`, `401`, `429`, `501`.

### `POST /api/v1/auth/logout`

- Purpose: revoke authenticated session.
- Responses: `204`, `401`, `501`.

## Prescription Intake

### `POST /api/v1/prescriptions`

- Purpose: submit prescription payload and scope for sourcing analysis.
- Success payload includes `legal` block (`title`, `bullets[]`, `surfaceNote`) for intake-surface legal copy consistency.
- Responses: `201`, `400`, `401`, `429`, `501`.

### `GET /api/v1/prescriptions/:prescriptionId`

- Purpose: retrieve submitted prescription metadata for owner/admin.
- Auth note: session cookie required; non-owner `USER` sessions receive `403`.
- UI note: `/timeline` can open a prescription detail panel via `?prescriptionId=<id>` and maps `401|403|404` outcomes to deterministic user-safe guidance.
- Responses: `200`, `401`, `403`, `404`, `501`.

## Sourcing Requests

### `POST /api/v1/sourcing-requests`

- Purpose: create offshore sourcing report request from a prescription.
- Responses: `201`, `400`, `401`, `409`, `501`.

### `GET /api/v1/sourcing-requests`

- Purpose: list authenticated user sourcing requests.
- Notes: returns owner-only request timeline entries (`requestId`, `status`, `createdAt`, `updatedAt`, `latestEventAt`, `reportFee`, `timeline[]`) and includes `legal` copy for request-surface consistency.
- Auth note: caller identity is resolved from session cookie only; `x-user-id` headers are ignored.
- UI consumption note: home and `/timeline` load this owner-scoped payload from active session context (no `userId` query parameter requirement); `/timeline` supports optional `requestId` focus.
- Responses: `200`, `401`.

### `GET /api/v1/sourcing-requests/:requestId`

- Purpose: fetch request status timeline and report metadata.
- Responses: `200`, `401`, `403`, `404`, `501`.

## Report Delivery Flow

### `GET /api/v1/sourcing-requests/:requestId/report`

- Purpose: retrieve secure report link/download metadata for owner.
- Success payload now includes `reportFee` metadata with deterministic report-service payment context: `{ product: "REPORT_SERVICE", required, feeCents, currency, paymentState }`.
- Success payload includes `legal` block (`title`, `bullets[]`, `surfaceNote`) for report-delivery legal copy consistency.
- Responses: `200`, `401`, `403`, `404`, `429`, `501`.

### `POST /api/v1/sourcing-requests/:requestId/report/ack`

- Purpose: acknowledge report delivery/receipt event.
- Notes:
  - owner-only endpoint.
  - when current state is `REPORT_READY` or `PAYMENT_SETTLED`, persists `REPORT_DELIVERY_ACKNOWLEDGED` audit marker and status event, then transitions request to `DELIVERED`.
  - idempotent when request is already `DELIVERED`.
- Responses: `200`, `401`, `403`, `404`, `409`.

### `POST /api/v1/sourcing-requests/:requestId/report-fee/checkout`

- Purpose: start owner-authenticated report-fee checkout intent for report-ready requests.
- Notes:
  - owner-only endpoint.
  - when current state is `REPORT_READY` and `reportPaymentRequired=true`, transitions to `PAYMENT_PENDING`.
  - writes immutable `SourcingStatusEvent` (`REPORT_READY -> PAYMENT_PENDING`) and `REPORT_FEE_CHECKOUT_INITIATED` audit marker.
  - idempotent when request is already `PAYMENT_PENDING|PAYMENT_SETTLED|DELIVERED`.
  - supports form-submit flow via optional `redirectTo` path and returns `303` when provided.
- Responses: `200`, `303`, `401`, `403`, `404`, `409`.

### `POST /api/v1/admin/sourcing-requests/:requestId/report-fee/settle`

- Purpose: record report-fee settlement webhook/stub outcome after checkout intent.
- Notes:
  - admin-only endpoint.
  - when current state is `PAYMENT_PENDING` and `reportPaymentRequired=true`, transitions to `PAYMENT_SETTLED`.
  - writes immutable `SourcingStatusEvent` (`PAYMENT_PENDING -> PAYMENT_SETTLED`) and `REPORT_FEE_SETTLEMENT_RECORDED` audit marker.
  - idempotent when request is already `PAYMENT_SETTLED|DELIVERED`.
  - once settled, owner report-delivery acknowledgment is unlocked via `POST /api/v1/sourcing-requests/:requestId/report/ack`.
  - supports form-submit flow via optional `redirectTo` path restricted to `/admin/sourcing-requests*`; returns `303` when valid.
  - successful form redirects append `settled=1` plus settlement metadata query markers (`settledBy`, `settledAt`) for deterministic admin UI confirmation state.
  - `200` JSON payload includes `settlement` envelope: `{ settledByUserId: string | null, settledAt: string | null }`.
- Responses: `200`, `401`, `403`, `404`, `409`.

## Admin Review and Report Upload

### `GET /api/v1/admin/sourcing-requests`

- Purpose: list admin sourcing requests for triage and settled-state verification.
- Query params:
  - `status` optional (`SUBMITTED|IN_REVIEW|PAYMENT_SETTLED|DELIVERED`)
  - `countryCode` optional ISO alpha-2 filter
  - `userEmail` optional owner email filter
- Notes:
  - without `status`, queue defaults to pending states (`SUBMITTED|IN_REVIEW`)
  - payload shape: `{ defaultFilterGroupKey: "TRIAGE", filterGroups: [{ key, displayOrder, label, description, statuses }], requests: [{ ..., settlement: { settledByUserId, settledAt } }] }`
  - `filterGroups` metadata is deterministic and API-owned:
    - `TRIAGE` -> `displayOrder: 10`, `label: "Triage queue"`, `description: "Submitted and in-review requests awaiting admin triage decisions."`, statuses `SUBMITTED|IN_REVIEW`
    - `SETTLED` -> `displayOrder: 20`, `label: "Settlement evidence queue"`, `description: "Settled and delivered requests with payment-settlement evidence attached."`, statuses `PAYMENT_SETTLED|DELIVERED`
  - `defaultFilterGroupKey` provides an API-owned default status lane for clients that render grouped status controls.
  - `statusMetadata` exposes API-owned per-status display metadata (`label`, `tone`) for `SUBMITTED|IN_REVIEW|PAYMENT_SETTLED|DELIVERED` so clients avoid hardcoded enum-to-copy or severity mapping drift.
  - `tone` enum is `NEUTRAL|WARNING|SUCCESS`; current queue mapping returns `WARNING` for `SUBMITTED|IN_REVIEW` and `SUCCESS` for `PAYMENT_SETTLED|DELIVERED`.
  - `settlement` metadata is populated only for `PAYMENT_SETTLED|DELIVERED` rows from immutable `PAYMENT_SETTLED` timeline events; otherwise fields are `null`.
  - UI binding: `/admin/sourcing-requests` consumes this contract with filter controls (`status`, `countryCode`, `userEmail`) and list-to-detail navigation.
  - UI filter guidance and grouped status options consume API `filterGroups` labels/descriptions and sort by API `displayOrder` (stable fallback to source order) while highlighting the active group (`TRIAGE` or `SETTLED`) for the current status filter.
  - SLA view note: admin queue page also computes throughput trend metrics from closed requests (`REPORT_READY|DELIVERED`) in the same filter scope, surfacing medians (`submit -> report-ready`, `submit -> delivered`) and `<24h|24-72h|>72h` buckets.
- Responses: `200`, `400`, `401`, `403`.

### `GET /api/v1/admin/sourcing-requests/:requestId`

- Purpose: fetch admin queue request detail with timeline and report artifacts.
- Notes:
  - response includes deterministic `request.settlement` metadata for non-redirect detail loads: `{ settledByUserId: string | null, settledAt: string | null }`.
  - settlement metadata is populated from immutable `PAYMENT_SETTLED` status events and remains `null` when settlement has not occurred.
  - admin queue UI settlement confirmation reads `request.settlement` first and uses settlement redirect query markers only as immediate post-submit fallback.
- Responses: `200`, `401`, `403`, `404`.

### `PATCH /api/v1/admin/sourcing-requests/:requestId/status`

- Purpose: perform lifecycle status transition.
- Notes:
  - currently supports explicit admin review decision transition to `IN_REVIEW` (for `SUBMITTED` requests).
  - writes immutable `ADMIN_REVIEW_DECISION_RECORDED` audit marker with transition context and status-event id.
- Responses: `200`, `400`, `401`, `403`, `404`, `409`.

### `POST /api/v1/admin/sourcing-requests/:requestId/status`

- Purpose: form-submit variant of admin review decision mutation for server-rendered admin queue UI.
- Notes:
  - accepts `application/x-www-form-urlencoded` or `multipart/form-data` (`toStatus`, optional `note`, optional `redirectTo`).
  - uses the same transition and audit contract as `PATCH`.
  - when `redirectTo` is a safe admin queue path, returns `303` redirect back to the queue detail context.
- Responses: `303`, `400`, `401`, `403`, `404`, `409`.

### `POST /api/v1/admin/sourcing-requests/:requestId/report-template-drafts`

- Purpose: persist admin-authored report-template draft content for request-detail authoring workflows.
- Notes:
  - accepts `application/x-www-form-urlencoded` or `multipart/form-data` (`templateId`, `templateBody`, optional `redirectTo`).
  - requires admin session cookie (`401` missing/invalid, `403` non-admin).
  - persists immutable draft snapshots as audit events (`ADMIN_REPORT_TEMPLATE_DRAFT_SAVED`) and request detail loads the latest saved draft for the currently selected `templateId`.
  - when `redirectTo` is a safe admin queue path, returns `303` redirect back to request detail context.
- Responses: `200`, `303`, `400`, `401`, `403`, `404`.

### `POST /api/v1/admin/sourcing-requests/:requestId/report-artifacts`

- Purpose: attach report artifact metadata and mark request as report-ready/delivered.
- Auth note: requires authenticated session cookie with persisted user role `ADMIN` (missing/invalid session -> `401`, non-admin role -> `403`).
- Responses: `200`, `400`, `401`, `403`, `404`, `501`.

## Compliance/GDPR

### `POST /api/v1/gdpr/export`

- Purpose: create personal-data export request.
- Auth note: requires authenticated session cookie (`401` when missing/invalid).
- Contract: returns `{ request: { requestId, status: "QUEUED", requestedAt } }`.
- Tracking note: request is persisted as immutable `GDPR_EXPORT_REQUESTED` audit evidence.
- Responses: `202`, `401`, `500`.

### `POST /api/v1/gdpr/delete`

- Purpose: create account deletion request.
- Auth note: requires authenticated session cookie (`401` when missing/invalid).
- Legal hold note: requests are rejected with `409 GDPR_DELETE_LEGAL_HOLD` while active sourcing work is still in progress (`SUBMITTED|IN_REVIEW`).
- Contract: returns `{ request: { requestId, status: "PENDING_REVIEW", requestedAt } }`.
- Tracking note: request is persisted as immutable `GDPR_DELETE_REQUESTED` audit evidence and must be executed by an admin review flow.
- Responses: `202`, `401`, `409`, `500`.

- UI note: authenticated users can review GDPR request history on /gdpr, including legal-hold guidance and latest request states derived from audit events.

### `GET /api/v1/admin/gdpr/delete-requests`

- Purpose: list pending GDPR account deletion requests for admin review.
- Auth note: requires admin session cookie (`401` missing/invalid, `403` non-admin).
- Contract: returns `{ requests: [{ requestId, userId, userEmail, requestedAt, status: "PENDING_REVIEW" }] }`.
- Responses: `200`, `401`, `403`, `500`.

### `POST /api/v1/admin/gdpr/delete-requests/:requestId/execute`

- Purpose: execute irreversible anonymization for a pending GDPR delete request after admin review.
- Auth note: requires admin session cookie (`401` missing/invalid, `403` non-admin).
- Contract: returns `{ request: { requestId, userId, status: "ANONYMIZED", requestedAt, completedAt, reviewedByAdminUserId } }`.
- Error note:
  - `404 GDPR_DELETE_REQUEST_NOT_FOUND` when request id does not match a queued request.
  - `409 GDPR_DELETE_REQUEST_NOT_PENDING` when request was already reviewed/executed.
  - `409 GDPR_DELETE_ALREADY_EXECUTED` on duplicate execute attempts.
  - `409 GDPR_DELETE_LEGAL_HOLD` if legal-hold constraints reappear before execution.
- Responses: `200`, `401`, `403`, `404`, `409`, `500`.
## 2026-03-06 Admin Audit Increment
- Admin report-artifact upload flow now emits two audit markers:
  - `REPORT_ARTIFACT_UPLOADED` (`entityType=ReportArtifact`) with upload + transition context.
  - `REPORT_READY_EMAIL_ENQUEUED` (`entityType=SourcingRequest`) for delivery notification pipeline marker.
- Follow-up (`AT-P1-05B`): add equivalent immutable audit event for explicit admin review decision transitions.
- `PATCH /api/v1/admin/sourcing-requests/:requestId/status` now emits `ADMIN_REVIEW_DECISION_RECORDED` (`entityType=SourcingRequest`) with deterministic context:
  - `fromStatus`
  - `toStatus`
  - `note`
  - `statusEventId`

### Detail settlement metadata note (AT-AUTO-BE-05)
- `GET /api/v1/admin/sourcing-requests/:requestId` now includes:
  - `request.settlement.settledByUserId: string | null`
  - `request.settlement.settledAt: string | null`
- Contract rule:
  - settlement metadata is populated only when request status is `PAYMENT_SETTLED` or `DELIVERED`;
  - non-settled statuses return `{ settledByUserId: null, settledAt: null }`.

Update 2026-03-09:
- Admin queue UI consumes API-owned `statusMetadata.tone` in two places: status badges on queue cards and selected-status helper text in filter controls.
- Recommended client fallback when tone is missing/unknown: `NEUTRAL`.
