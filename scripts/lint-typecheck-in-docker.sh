#!/usr/bin/env bash
set -euo pipefail

# Minimal gates runner for CI/preview validation without tests/build.
# Intended to run inside node:22 container with repository mounted at /workspace.

npm ci
npm run prisma:generate
npm run lint
npm run typecheck

