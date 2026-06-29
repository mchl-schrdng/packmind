import * as fs from "node:fs";
import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { findRoot } from "../state/project.js";
import { brain } from "../state/files.js";
import { createSnapshot, listSnapshots, restoreSnapshot } from "../state/snapshot.js";

export function runBackup(opts: { list?: boolean } = {}): void {
  // Listing must work even if the brain is broken — resolve the root directly.
  const projectRoot = opts.list ? findRoot() : requireProject().projectRoot;
  if (opts.list) {
    const snaps = listSnapshots(projectRoot);
    if (!snaps.length) {
      console.log(chalk.dim("No backups yet."));
      return;
    }
    console.log(chalk.bold.cyan("\nBackups:\n"));
    for (const s of snaps) console.log("  " + s);
    console.log("");
    return;
  }
  console.log(chalk.green(`✓ Backup created: ${createSnapshot(projectRoot)}`));
}

export function runRestore(label?: string): void {
  // Restore is a recovery command: it must run even when .packmind/ is missing
  // or corrupt, so it does NOT require an initialized project.
  const projectRoot = findRoot();
  const snaps = listSnapshots(projectRoot);
  if (!label) {
    if (!snaps.length) {
      console.log(chalk.dim("No backups to restore for this project."));
      return;
    }
    console.log(chalk.bold.cyan("\nAvailable backups:\n"));
    for (const s of snaps) console.log("  " + s);
    console.log(chalk.dim("\nRun `packmind restore <timestamp>` to restore one.\n"));
    return;
  }
  if (restoreSnapshot(projectRoot, label)) {
    const hasRecall = fs.existsSync(brain(projectRoot).vectors);
    console.log(chalk.green(`✓ Restored .packmind/ from ${label}`));
    if (!hasRecall) console.log(chalk.dim("  (run `packmind index` to rebuild the semantic index)"));
  } else {
    console.error(chalk.red(`✗ No backup "${label}" for this project.`));
    process.exit(1);
  }
}
