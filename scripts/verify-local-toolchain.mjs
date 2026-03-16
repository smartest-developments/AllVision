#!/usr/bin/env node

import { accessSync, constants } from "node:fs";
import path from "node:path";
import process from "node:process";

const requiredBins = ["next", "tsc", "vitest", "prisma"];
const repoRoot = process.cwd();

const missing = [];
for (const bin of requiredBins) {
  const binPath = path.join(repoRoot, "node_modules", ".bin", bin);
  try {
    accessSync(binPath, constants.X_OK);
  } catch {
    missing.push(bin);
  }
}

if (missing.length > 0) {
  console.error(
    [
      "toolchain check failed:",
      `missing executables in node_modules/.bin: ${missing.join(", ")}`,
      "run `npm install` from the repo root, then rerun `npm run doctor:toolchain`.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `toolchain check passed: ${requiredBins.join(", ")} available in node_modules/.bin`,
);
