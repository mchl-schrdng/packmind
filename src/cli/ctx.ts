import * as fs from "node:fs";
import chalk from "chalk";
import { findRoot } from "../state/project.js";
import { brain } from "../state/files.js";
import { loadConfig, type Config } from "../state/schema.js";

export interface CliCtx {
  projectRoot: string;
  config: Config;
}

/** Resolve an initialized project or exit with a helpful message. */
export function requireProject(): CliCtx {
  const projectRoot = findRoot();
  if (!fs.existsSync(brain(projectRoot).config)) {
    console.error(chalk.red("✗ No .packmind/ here. Run `packmind init` first."));
    process.exit(1);
  }
  return { projectRoot, config: loadConfig(brain(projectRoot).config) };
}
