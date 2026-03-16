# AllVision

AllVision is an informational service for users in the EU + Switzerland.
Users submit eyeglasses prescription data and receive an offshore sourcing report with comparative pricing and sourcing guidance.

## Product Goal

- Sell an informational sourcing report, not lenses.
- No sale of medical devices.
- No brokerage, mediation, or purchase execution.
- No medical advice.
- Account-required workflow: prescription intake -> sourcing report in progress -> report delivered.
- Paid-ready for report service fees (MVP can run free).

## Tech Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- PostgreSQL + Prisma ORM
- Vitest for unit/integration tests

## Quick Start

### Prerequisites

- Node.js 22.x (>=22 <23)
- npm 10+
- Docker (for local PostgreSQL via Docker Compose)

### Setup

```bash
npm install
docker compose up -d
cp .env.example .env
npm run prisma:generate
npm run dev
```

Open `http://localhost:3000`.

Run all compose commands from the repository root (where `docker-compose.yml` is located).

### Local DB (quick bring-up)

```bash
docker compose up -d db && npm run prisma:migrate:deploy
```


## Scripts

- `npm run dev` - start local dev server
- `npm run build` - production build
- `npm run start` - run production server
- `npm run lint` - ESLint checks
- `npm run typecheck` - TypeScript checks
- `npm run test` - all tests
- `npm run test:unit` - unit tests only
- `npm run test:integration` - integration tests only
- `npm run prisma:generate` - generate Prisma client
- `npm run prisma:migrate:dev` - run local migrations
- `npm run prisma:migrate:deploy` - run deploy migrations

### Optional: Run gates in Docker (no local Node)

If Node/npm aren’t installed locally, you can run the mandatory gates inside a Node 22 container. Ensure Postgres is up (`docker compose up -d db`), then:

```bash
scripts/run-gates-in-docker.sh
```

The script mounts the repo into `node:22`, defaults `DATABASE_URL` to `host.docker.internal:5433`, and runs: install, prisma generate, lint, typecheck, tests, and build.

## Documentation Index

- `/docs/PRD.md`
- `/docs/LEGAL_POSITIONING.md`
- `/docs/SECURITY.md`
- `/docs/GDPR.md`
- `/docs/ARCHITECTURE.md`
- `/docs/API_SPEC.md`
- `/docs/ADR/0001-tech-stack.md`
- `/plan/TASK_BACKLOG.md`
- `/plan/PROGRESS_LOG.md`
- `/plan/HEALTH_SCORE.md`
- `/plan/PRODUCT_READINESS_SCORE.md`


## Public Preview

- Demo-safe, read-only preview route: `/public-preview`
- Local URL: http://localhost:3000/public-preview
- Safety: Renders mock data only; no API or DB calls.
- When deployed to a public host, update `docs/PUBLIC_PREVIEW.md` with the public URL.
