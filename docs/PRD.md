# Product Requirements Document (PRD)

## Product Summary

AllVision is an informational offshore sourcing report service for eyeglasses lenses in the EU + Switzerland.
Users provide existing prescription data, and AllVision delivers a comparative sourcing report prepared through admin review.

## Problem

Users often lack transparent, comparable information about lens sourcing options across borders.
AllVision reduces search complexity by packaging comparative information into a structured report.

## Core Positioning

- We do not sell lenses or any medical devices.
- We do not broker, mediate, or execute purchases.
- We provide comparative information and sourcing guidance.
- Users are solely responsible for final purchase decisions.
- We do not provide medical advice.

## Target Users

- Adults in EU + Switzerland who already have a prescription.
- Users seeking offshore sourcing clarity before deciding where to buy.

## MVP Scope

1. Account creation and login (email/password first; social optional later).
2. Prescription intake with validation.
3. Offshore sourcing report lifecycle:
   - request submitted
   - report in progress (admin review)
   - report ready
   - report delivered
4. Admin panel for manual review and report creation/upload.
5. Report delivery flow (secure link/download and email notification stub).
6. Paid-ready service model for informational report fees (MVP may be free).
7. Compliance baseline: legal disclaimers, GDPR operations, audit events.

## Non-Goals (MVP)

- Selling, shipping, or listing lenses for sale.
- Transaction brokering, purchasing on behalf of users, or supplier mediation.
- Medical diagnosis, prescription generation, or treatment recommendations.
- Guaranteed savings promises.
- Automated sourcing intelligence at launch.

## Success Metrics (MVP)

- Submission-to-delivery completion rate.
- Median turnaround time for report delivery.
- First-pass valid prescription submission rate.
- User-reported usefulness of comparative information.

## Risks

- Misinterpretation of service as seller/broker if wording is imprecise.
- Handling prescription data that may be treated as sensitive health-related data.
- Manual admin throughput bottlenecks.

## Release Criteria

- Legal positioning appears at critical surfaces and API contracts.
- Lifecycle works end-to-end with auditability.
- Lint, typecheck, tests, and build are green.

## Session Note (2026-03-15T15:00:00+0100)
- Extended post-ack settlement-note resilience guardrails to seventy-two-line trailing mixed-width separator variants.
- Backend redirect metadata canonicalization and timeline payload precedence remain deterministic for long separator tails.
