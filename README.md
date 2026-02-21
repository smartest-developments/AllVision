# AllVision

AllVision is an informational service for eyeglass lens buyers in the EU + Switzerland.
Users submit lens prescription data and receive a manual price-comparison + sourcing report.

## Product Goal

- Sell an information product (report + guidance), not lenses.
- No brokerage, no order placement, no medical advice.
- Account required for request lifecycle and report delivery.
- MVP flow: request submitted -> quote in progress -> admin review -> report delivered -> payment handling (paid-ready, may be free initially).

## Tech Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- PostgreSQL + Prisma ORM
- Vitest for unit/integration tests

## Quick Start

### Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL (for future DB tasks)

### Setup

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run dev
```

Open `http://localhost:3000`.

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
