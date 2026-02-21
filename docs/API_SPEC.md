# API Specification (MVP Draft)

Status: endpoint contract draft. Unimplemented routes may return `501 Not Implemented` during bootstrap.

## Conventions

- Base path: `/api/v1`
- Auth: session cookie (MVP)
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

## Auth

### `POST /api/v1/auth/register`

- Purpose: create account using email/password.
- Request:

```json
{
  "email": "user@example.com",
  "password": "StrongPass123!"
}
```

- Responses: `201`, `400`, `409`, `429`, `501`.

### `POST /api/v1/auth/login`

- Purpose: create authenticated session.
- Responses: `200`, `401`, `429`, `501`.

### `POST /api/v1/auth/logout`

- Purpose: invalidate session.
- Responses: `204`, `401`, `501`.

## Quote Requests

### `POST /api/v1/quotes`

- Purpose: submit prescription for quote/report generation.
- Request fields:
  - `countryCode` (EU/CH scope)
  - `prescription` (left/right eye values, PD, optional notes)
- Responses: `201`, `400`, `401`, `429`, `501`.

### `GET /api/v1/quotes`

- Purpose: list authenticated user quote requests.
- Responses: `200`, `401`, `501`.

### `GET /api/v1/quotes/:quoteId`

- Purpose: fetch quote status and report metadata.
- Responses: `200`, `401`, `403`, `404`, `501`.

## Report Delivery

### `GET /api/v1/quotes/:quoteId/report`

- Purpose: get secure report link or download payload.
- Responses: `200`, `401`, `403`, `404`, `429`, `501`.

## Payments (Paid-ready)

### `POST /api/v1/payments/checkout-session`

- Purpose: start payment for report service product.
- Responses: `200`, `400`, `401`, `409`, `501`.

### `POST /api/v1/payments/webhook`

- Purpose: receive provider payment events.
- Responses: `200`, `400`, `401`, `501`.

## Admin

### `GET /api/v1/admin/quotes`

- Purpose: list queued/in-review quotes for admins.
- Responses: `200`, `401`, `403`, `501`.

### `PATCH /api/v1/admin/quotes/:quoteId/status`

- Purpose: update quote lifecycle status.
- Responses: `200`, `400`, `401`, `403`, `404`, `409`, `501`.

### `POST /api/v1/admin/quotes/:quoteId/report`

- Purpose: attach report artifact and mark as ready/delivered.
- Responses: `200`, `400`, `401`, `403`, `404`, `501`.

## Compliance/GDPR

### `POST /api/v1/gdpr/export`

- Purpose: create personal data export request.
- Responses: `202`, `401`, `429`, `501`.

### `POST /api/v1/gdpr/delete`

- Purpose: create account deletion request.
- Responses: `202`, `401`, `429`, `501`.
