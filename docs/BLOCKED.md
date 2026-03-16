# Blocked: Local Toolchain Missing (2026-03-16)

This run is blocked from executing mandatory quality gates (lint, typecheck, tests, build) because Node.js and npm are not available on this workstation shell.

## Evidence

```
$ node -v
zsh: command not found: node

$ npm -v
zsh: command not found: npm

$ docker compose version
Docker Compose version v5.0.2
```

Postgres can be started via Docker, but without Node/npm we cannot install dependencies nor run `next`, `tsc`, `vitest`, or `prisma` CLI.

## Unblock Steps (local)

1) Install Node.js 22.x LTS and npm
   - With nvm: `brew install nvm && nvm install 22 && nvm use 22`
   - Or with asdf: `asdf plugin add nodejs && asdf install nodejs latest && asdf global nodejs <version>`

2) Install repo dependencies
   - `npm ci` (preferred) or `npm install`

3) Start local Postgres and apply migrations
   - `docker compose up -d db`
   - `npx prisma migrate deploy` (or `npm run prisma:migrate:deploy`)

4) Verify local toolchain
   - `npm run doctor:toolchain`

5) Run mandatory gates
   - `npm run lint && npm run typecheck && npm run test && npm run build`

## Next Actions After Unblock

- Re-run the gates above. If green, commit any pending changes and push.
- Execute the paid report delivery flow test: `npm run test -- tests/integration/report-paid-delivery-flow.test.ts`.
- Optional readiness follow-up (tracked as AT-OPS-002 in backlog): pin Node version via `.nvmrc`/`engines` and add a short setup alias for `docker compose up -d db`.

