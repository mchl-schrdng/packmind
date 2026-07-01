import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { harvestDebt } from "../state/debt.js";

/** List the `packmind:` deferred-shortcut markers left in the codebase. */
export function runDebt(): void {
  const { projectRoot, config } = requireProject();
  const items = harvestDebt(projectRoot, config);
  if (items.length === 0) {
    console.log(chalk.dim("No `packmind:` debt markers found. Clean slate."));
    return;
  }
  console.log(chalk.bold(`\n${items.length} deferred shortcut${items.length === 1 ? "" : "s"}:\n`));
  for (const it of items) {
    console.log(`  ${chalk.cyan(`${it.file}:${it.line}`)}  ${it.note}`);
  }
  console.log("");
}
