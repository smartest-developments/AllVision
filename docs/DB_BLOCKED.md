# DB Blocked

- Timestamp: 2026-03-03T16:00:00+01:00 (Europe/Zurich)
- Phase: PHASE 0 — INFRA ENFORCEMENT
- Check failed: `.env` file is missing at repository root.
- Impact: `DATABASE_URL` is not defined, so DB startup and Prisma checks cannot proceed.

## Exact stop reason
Run stopped by guardrail: "Ensure `.env` exists and `DATABASE_URL` is defined. If missing or fake, write `docs/DB_BLOCKED.md` and STOP."

## Required action to unblock
1. Create `.env` in repository root.
2. Define a real `DATABASE_URL` pointing to the Docker Postgres service (no placeholder/stub).
3. Re-run automation.
