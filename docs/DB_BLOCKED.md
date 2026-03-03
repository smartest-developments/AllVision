# DB Blocked

Date: 2026-03-03
Phase: 0 - Infra enforcement

## Blocking condition
`.env` is missing at repository root, so `DATABASE_URL` is not defined.

## Evidence
- Command: `test -f .env`
- Result: `.env missing`

## Required action
Create `.env` from `.env.example` and set a real `DATABASE_URL` that points to the running Postgres container.

Execution stopped per guarded-mode hard rules.
