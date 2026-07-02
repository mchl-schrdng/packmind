import * as path from "node:path";
import * as fs from "node:fs";
import chalk from "chalk";
import { readJsonOr, writeJson } from "../util/fs-atomic.js";
import { DEFAULT_CONFIG, deepMerge, type Config } from "../state/schema.js";
import { brain } from "../state/files.js";
import { registerHooks, registerMcp } from "../adapters/claude-code.js";
import { TEMPLATES_DIR, HOOKS_DIST_DIR, pkgVersion } from "./locate.js";
import { pruneRegistry, registerProject, type RegistryEntry } from "./registry.js";
import { seedBrainFiles } from "./seed.js";
import { createSnapshot } from "../state/snapshot.js";

const ALWAYS_OVERWRITE = ["PACKMIND.md"];
const HOOK_SCRIPTS = [
  "runtime.js", "session-start.js", "prompt-submit.js", "pre-read.js",
  "post-read.js", "pre-write.js", "post-write.js", "stop.js",
];

function copy(src: string, dest: string): void {
  if (fs.existsSync(src)) fs.writeFileSync(dest, fs.readFileSync(src));
}

function updateOne(entry: RegistryEntry, dryRun: boolean): void {
  const b = brain(entry.root);
  if (!fs.existsSync(b.dir)) {
    console.log(chalk.dim(`  skip ${entry.name} (no .packmind/)`));
    return;
  }
  if (dryRun) {
    console.log(chalk.dim(`  would update ${entry.name}`));
    return;
  }

  // Safety net: snapshot before mutating anything.
  try {
    createSnapshot(entry.root);
  } catch {
    /* backup is best-effort; never block an update on it */
  }

  for (const f of ALWAYS_OVERWRITE) copy(path.join(TEMPLATES_DIR, f), path.join(b.dir, f));

  // Seed any brain files introduced since this install was created (e.g. a
  // policy.json an older version never wrote), and refresh .gitattributes/.gitignore.
  seedBrainFiles(b.dir);

  // config.json: deep-merge template defaults UNDER the user's existing config,
  // preserving any values they customized while adding new keys.
  const existing = readJsonOr<Partial<Config>>(b.config, {});
  writeJson(b.config, deepMerge(DEFAULT_CONFIG, existing));

  fs.mkdirSync(b.hooksDir, { recursive: true });
  for (const s of HOOK_SCRIPTS) copy(path.join(HOOKS_DIST_DIR, s), path.join(b.hooksDir, s));
  copy(path.join(TEMPLATES_DIR, "hooks-package.json"), path.join(b.hooksDir, "package.json"));

  const config = deepMerge(DEFAULT_CONFIG, existing);
  registerHooks(path.join(entry.root, config.claude.settingsPath));
  registerMcp(path.join(entry.root, ".mcp.json"));
  registerProject(entry.root, pkgVersion());
  console.log(`  ${chalk.green("✓")} ${entry.name}`);
}

export function runUpdate(opts: { dryRun?: boolean; list?: boolean; project?: string } = {}): void {
  const projects = pruneRegistry();
  if (opts.list) {
    console.log(chalk.bold.cyan("\nRegistered projects:\n"));
    for (const p of projects) console.log(`  ${p.name}  ${chalk.dim(p.root)}  v${p.version}`);
    console.log("");
    return;
  }
  const targets = opts.project
    ? projects.filter((p) => p.name === opts.project || p.root.includes(opts.project!))
    : projects;
  if (targets.length === 0) {
    console.log(chalk.dim("No matching projects."));
    return;
  }
  console.log(chalk.bold.cyan(`\nUpdating ${targets.length} project(s) to v${pkgVersion()}...\n`));
  for (const t of targets) updateOne(t, !!opts.dryRun);
  console.log("");
}
