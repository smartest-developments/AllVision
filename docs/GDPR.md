# GDPR Baseline

## Scope and Roles

- AllVision acts as data controller for account and report-service operations.
- Data subjects are users located in EU + Switzerland.

## Lawful Basis (MVP)

- Contract performance: process quote requests and deliver report.
- Legitimate interests: security logging, abuse prevention, service reliability.

## Data Minimization

Collect only what is needed:

- account: email, password hash, auth metadata,
- request: prescription data, country, status,
- operations: audit logs needed for compliance and security.

Do not collect unnecessary health context or unrelated personal profile data.

## Purpose Limitation

- Data is used to generate and deliver the informational report service.
- Data is not sold to third parties.
- Data is not used for medical decisions.

## Retention Baseline

- Active account data retained while account is active.
- Quote/report records retained for service history and compliance.
- Define concrete retention schedule before production launch (for example: inactive accounts reviewed after 24 months).

## Data Subject Rights

Support rights workflows:

- access/export request,
- rectification,
- deletion request,
- objection/restriction where applicable.

Implement authenticated requests and log request handling timeline.

## Deletion and Export Operations

- Export: machine-readable JSON package containing account + quote history.
- Deletion: soft-delete workflow first, then hard-delete or irreversible anonymization after legal hold checks.
- Retain minimal audit evidence that deletion/export was executed.

## Processor and Transfer Controls

- Maintain processor inventory (hosting, email, payments).
- Ensure DPAs with processors.
- Use approved transfer safeguards for non-EU processing locations.

## Security and Privacy by Design

- Access controls, encryption, least privilege, and auditability are required.
- Privacy checks are part of backlog definition-of-done for relevant tasks.
