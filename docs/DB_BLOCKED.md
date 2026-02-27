# DB Blocked

Date: 2026-02-27
Phase: PHASE 0 — INFRA ENFORCEMENT

## Blocking condition
- Missing `.env` file at repository root.
- `DATABASE_URL` cannot be verified because `.env` is absent.

## Required action
1. Create `.env` in repo root.
2. Define a real `DATABASE_URL` (no placeholder/stub).
3. Re-run automation so DB bootstrap and Prisma checks can proceed.

Automation stopped per guardrail: "No stub DATABASE_URL" and "If DB is unavailable -> STOP".
