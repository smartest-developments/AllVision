# ADR 0001: Adopt Next.js + TypeScript + Tailwind + Postgres + Prisma

- Status: Accepted
- Date: 2026-02-21

## Context

AllVision needs a modern full-stack web foundation with strong DX, type safety, and a clean path from MVP manual operations to later automation.

## Decision

Use:

- Next.js (App Router) for web app and server routes.
- TypeScript for type-safe end-to-end contracts.
- Tailwind CSS for fast, consistent UI delivery.
- PostgreSQL for relational persistence.
- Prisma as ORM and schema migration layer.

## Consequences

### Positive

- Fast iteration with one framework for UI + API.
- Strong type safety for request lifecycle and validation.
- Mature ecosystem for auth, payments, and observability integrations.

### Negative

- Need discipline around server/client boundaries in App Router.
- Prisma migrations require operational care in production environments.

## Alternatives Considered

- Separate frontend/backend stack: rejected to reduce MVP complexity.
- No ORM with raw SQL: rejected for slower onboarding and schema safety tradeoffs.
