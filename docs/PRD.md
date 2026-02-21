# Product Requirements Document (PRD)

## Product Summary

AllVision is an informational product for EU + Switzerland users who want to compare eyeglasses lens sourcing options abroad.
The platform collects prescription inputs, then delivers a manual price-comparison + sourcing report with practical guidance.

## Problem

Users can struggle to identify transparent lens pricing and sourcing options across borders. The process is fragmented and time-consuming.

## Core Positioning

- We do not sell lenses.
- We do not broker transactions.
- We sell information: a structured report and sourcing guidance.
- We do not provide medical advice.

## Target Users

- Adults in EU + Switzerland evaluating lens purchase options abroad.
- Cost-conscious users who can provide an existing prescription.

## MVP Scope

1. Account creation and login (email/password first; social optional later).
2. Prescription intake form with validation.
3. Quote request lifecycle:
   - submitted
   - in review (quote in progress)
   - report ready/delivered
4. Admin panel for manual review and report generation.
5. Report delivery artifact (secure download link or email link).
6. Paid-ready workflow for report payment (MVP may run as free while keeping payment model-ready).
7. Compliance baseline: legal disclaimers, GDPR processes, audit events.

## Non-Goals (MVP)

- Selling or shipping lenses.
- Acting as broker/agent for lens purchases.
- Medical diagnosis, prescription generation, or treatment recommendations.
- Automated quote scraping engine at launch.
- Native mobile applications.

## Success Metrics (MVP)

- Request-to-report completion rate.
- Median turnaround time from submission to report delivery.
- Percentage of requests with complete required data at first submission.
- Payment conversion rate (once payment is enabled).

## Risks

- Regulatory confusion if language implies commerce or medical claims.
- Data sensitivity around prescription details and account information.
- Manual operations bottlenecks in admin review.

## Release Criteria

- Legal positioning text is present at all critical UI/API touchpoints.
- Core lifecycle works end-to-end with audit events.
- Lint, typecheck, unit tests, integration tests, and build are green.
