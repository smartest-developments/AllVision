# GDPR Baseline

## Scope and Roles

- AllVision acts as data controller for account and informational report-service operations.
- Data subjects are users in EU + Switzerland.

## Lawful Basis (MVP)

- Contract performance: process sourcing requests and deliver informational reports.
- Legitimate interests: service security, abuse prevention, and operational reliability.
- Where required by jurisdictional interpretation, obtain explicit consent for processing prescription data.

## Sensitive Data Handling

Prescription data may be treated as health-related or special-category personal data depending on context and regulatory interpretation.
Controls:

- collect only fields necessary to generate the report,
- segregate access and restrict to authorized personnel,
- log access and changes with audit events,
- apply stricter retention and deletion controls,
- avoid secondary use unrelated to report generation.

## Data Minimization

Collect only what is required:

- account: email, password hash, authentication metadata,
- prescription intake: optical values and sourcing scope fields,
- service operations: request lifecycle and audit records.

## Purpose Limitation

- Data is processed solely to prepare and deliver comparative sourcing reports.
- Data is not sold.
- Data is not used for medical treatment decisions.

## Retention Baseline

- Keep account and request data while service relationship remains active.
- Define production retention schedule before launch (including sensitive-data windows).
- Periodically review stale accounts/requests and purge or anonymize per policy.

## Data Subject Rights

Support authenticated workflows for:

- access/export,
- rectification,
- deletion,
- objection/restriction where applicable.

Track request timestamps, status, and completion evidence.

## Deletion and Export Operations

- Export: machine-readable package containing account, prescription, request lifecycle, and report metadata.
- Deletion: soft-delete first, then hard-delete or irreversible anonymization after legal-hold checks.
- Preserve minimal audit evidence for compliance proof.
- Current API baseline:
  - `POST /api/v1/gdpr/export` persists `GDPR_EXPORT_REQUESTED` with queued status context.
  - `POST /api/v1/gdpr/delete` enforces legal-hold guard (`SUBMITTED|IN_REVIEW` block) and records `GDPR_DELETE_REQUESTED` with `PENDING_REVIEW` status.
  - `POST /api/v1/admin/gdpr/delete-requests/:requestId/execute` executes anonymization (`GDPR_DELETE_COMPLETED`) after admin review, revokes sessions, and redacts account/prescription fields.

## Processor and Transfer Controls

- Maintain processor inventory (hosting, email, optional payment provider).
- Ensure signed DPAs.
- Apply valid transfer safeguards for non-EU processing locations.

## Privacy by Design

- Privacy checks are required in definition-of-done for relevant changes.
- New features require review for minimization, lawful basis, and user transparency.

## UI status route (2026-03-06)
- Added authenticated `/gdpr` page for self-service request visibility.
- The page lists recent `GDPR_EXPORT_REQUESTED`, `GDPR_DELETE_REQUESTED`, and `GDPR_DELETE_COMPLETED` audit events for the signed-in user.
- Signed-out users receive deterministic auth CTAs with `next=/gdpr` preservation.
- Legal-hold guidance is surfaced inline: deletion may return `409 GDPR_DELETE_LEGAL_HOLD` while requests are in `SUBMITTED` or `IN_REVIEW`.
- Admin operators can review pending delete requests on `/admin/gdpr-delete-requests` and execute anonymization with immutable reviewer attribution.
