# DB Blocked

Date: 2026-02-27

Automation run stopped during **PHASE 0 — INFRA ENFORCEMENT**.

## Blocking checks

1. `.env` file is missing at repository root.
2. `DATABASE_URL` could not be verified because `.env` is missing.
3. Database container could not be started.

## Exact error

```text
unable to get image 'postgres:16': Cannot connect to the Docker daemon at unix:///Users/simones/.docker/run/docker.sock. Is the docker daemon running?
```

## Required unblock actions

1. Create `.env` in repo root and define a real `DATABASE_URL`.
2. Start Docker daemon and verify `docker compose up -d` works.
3. Re-run automation.
