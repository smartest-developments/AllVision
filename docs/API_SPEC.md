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

- Purpose: retrieve submitted prescription metadata for owner.
- Responses: `200`, `401`, `403`, `404`, `501`.

## Sourcing Requests

### `POST /api/v1/sourcing-requests`

- Purpose: create offshore sourcing report request from a prescription.
- Responses: `201`, `400`, `401`, `409`, `501`.

### `GET /api/v1/sourcing-requests`

- Purpose: list authenticated user sourcing requests.
- Notes: returns owner-only request timeline entries (`requestId`, `status`, `createdAt`, `updatedAt`, `latestEventAt`, `timeline[]`) and includes `legal` copy for request-surface consistency.
- UI consumption note: `/timeline` supports optional client-side `requestId` focus against this owner-scoped payload.
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
- Responses: `200`, `401`, `403`, `501`.

### `PATCH /api/v1/admin/sourcing-requests/:requestId/status`

- Purpose: perform lifecycle status transition.
- Responses: `200`, `400`, `401`, `403`, `404`, `409`, `501`.

### `POST /api/v1/admin/sourcing-requests/:requestId/report-artifacts`

- Purpose: attach report artifact metadata and mark request as report-ready/delivered.
- Responses: `200`, `400`, `401`, `403`, `404`, `501`.

## Compliance/GDPR

### `POST /api/v1/gdpr/export`

- Purpose: create personal-data export request.
- Responses: `202`, `401`, `429`, `501`.

### `POST /api/v1/gdpr/delete`

- Purpose: create account deletion request.
- Responses: `202`, `401`, `429`, `501`.
