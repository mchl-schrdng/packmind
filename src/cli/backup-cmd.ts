import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { createSnapshot, listSnapshots, restoreSnapshot } from "../state/snapshot.js";

export function runBackup(opts: { list?: boolean } = {}): void {
  const { projectRoot } = requireProject();
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
  const { projectRoot } = requireProject();
  const snaps = listSnapshots(projectRoot);
  if (!label) {
    if (!snaps.length) {
      console.log(chalk.dim("No backups to restore."));
      return;
    }
    console.log(chalk.bold.cyan("\nAvailable backups:\n"));
    for (const s of snaps) console.log("  " + s);
    console.log(chalk.dim("\nRun `packmind restore <timestamp>` to restore one.\n"));
    return;
  }
  if (restoreSnapshot(projectRoot, label)) {
    console.log(chalk.green(`✓ Restored .packmind/ from ${label}`));
  } else {
    console.error(chalk.red(`✗ No backup "${label}" for this project.`));
    process.exit(1);
  }
}
