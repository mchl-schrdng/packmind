import chalk from "chalk";
import * as path from "node:path";
import { requireProject } from "./ctx.js";
import { computeInsights } from "../cost/insights.js";

export function runInsights(): void {
  const { projectRoot, config } = requireProject();
  const r = computeInsights(projectRoot, config);

  console.log(chalk.bold.cyan("\nPackMind insights - ") + chalk.bold(path.basename(projectRoot)));
  console.log(`  cost so far:     ${chalk.green("$" + r.totalCost.toFixed(4))} ` +
    chalk.dim(`(${r.inputTokens.toLocaleString()} in / ${r.outputTokens.toLocaleString()} out)`));
  console.log(`  est. saved:      ${chalk.green("$" + r.estCostSaved.toFixed(4))} ` +
    chalk.dim(`(~${r.estTokensSaved.toLocaleString()} tokens, ${r.reReadsAvoided} re-reads avoided)`));
  console.log(`  map coverage:    ${r.mapCoverage === null ? "-" : Math.round(r.mapCoverage * 100) + "%"}`);

  if (r.topFiles.length) {
    console.log(chalk.bold("\n  Heaviest files:"));
    for (const f of r.topFiles) {
      console.log(`    ${chalk.dim(f.tokens.toString().padStart(6))} tok  ${chalk.dim("$" + f.cost.toFixed(4))}  ${f.file}`);
    }
  }

  if (r.flags.length) {
    console.log(chalk.bold("\n  Notes:"));
    for (const f of r.flags) {
      const icon = f.level === "good" ? chalk.green("✓") : chalk.yellow("!");
      console.log(`    ${icon} ${f.title} - ${chalk.dim(f.detail)}`);
    }
  }
  console.log("");
}
