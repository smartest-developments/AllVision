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
- Notes: returns owner-only request timeline entries (`requestId`, `status`, `createdAt`, `updatedAt`, `latestEventAt`, `timeline[]`) and includes `legal` copy for request-surface consistency.
- Auth note: caller identity is resolved from session cookie only; `x-user-id` headers are ignored.
- UI consumption note: home and `/timeline` load this owner-scoped payload from active session context (no `userId` query parameter requirement); `/timeline` supports optional `requestId` focus.
- Responses: `200`, `401`.

### `GET /api/v1/sourcing-requests/:requestId`

- Purpose: fetch request status timeline and report metadata.
- Responses: `200`, `401`, `403`, `404`, `501`.

## Report Delivery Flow

### `GET /api/v1/sourcing-requests/:requestId/report`

- Purpose: retrieve secure report link/download metadata for owner.
- Success payload includes `legal` block (`title`, `bullets[]`, `surfaceNote`) for report-delivery legal copy consistency.
- Responses: `200`, `401`, `403`, `404`, `429`, `501`.

### `POST /api/v1/sourcing-requests/:requestId/report/ack`

- Purpose: acknowledge report delivery/receipt event.
- Responses: `200`, `401`, `403`, `404`, `501`.

## Admin Review and Report Upload

### `GET /api/v1/admin/sourcing-requests`

- Purpose: list queued/in-review sourcing requests.
- Query params:
  - `status` optional (`SUBMITTED|IN_REVIEW`)
  - `countryCode` optional ISO alpha-2 filter
  - `userEmail` optional owner email filter
- Notes:
  - without `status`, queue defaults to pending states (`SUBMITTED|IN_REVIEW`)
  - payload shape: `{ requests: [...] }`
  - UI binding: `/admin/sourcing-requests` consumes this contract with filter controls (`status`, `countryCode`, `userEmail`) and list-to-detail navigation.
- Responses: `200`, `400`, `401`, `403`.

### `GET /api/v1/admin/sourcing-requests/:requestId`

- Purpose: fetch admin queue request detail with timeline and report artifacts.
- Responses: `200`, `401`, `403`, `404`.

### `PATCH /api/v1/admin/sourcing-requests/:requestId/status`

- Purpose: perform lifecycle status transition.
- Notes:
  - currently supports explicit admin review decision transition to `IN_REVIEW` (for `SUBMITTED` requests).
  - writes immutable `ADMIN_REVIEW_DECISION_RECORDED` audit marker with transition context and status-event id.
- Responses: `200`, `400`, `401`, `403`, `404`, `409`.

### `POST /api/v1/admin/sourcing-requests/:requestId/report-artifacts`

- Purpose: attach report artifact metadata and mark request as report-ready/delivered.
- Auth note: requires authenticated session cookie with persisted user role `ADMIN` (missing/invalid session -> `401`, non-admin role -> `403`).
- Responses: `200`, `400`, `401`, `403`, `404`, `501`.

## Compliance/GDPR

### `POST /api/v1/gdpr/export`

- Purpose: create personal-data export request.
- Responses: `202`, `401`, `429`, `501`.

### `POST /api/v1/gdpr/delete`

- Purpose: create account deletion request.
- Responses: `202`, `401`, `429`, `501`.

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
