#!/usr/bin/env node
import { createProgram } from "../cli/index.js";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`PackMind requires Node.js 20+. You are running ${process.version}.`);
  process.exit(1);
}

createProgram()
  .parseAsync(process.argv)
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
