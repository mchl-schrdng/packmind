import chalk from "chalk";
import * as path from "node:path";
import { requireProject } from "./ctx.js";
import { readLedger, totalCost } from "../cost/ledger.js";
import { readTextOr } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";
import { countMapEntries } from "../state/mapper.js";
import { VectorStore } from "../recall/store.js";
import { peekQueue } from "../recall/queue.js";

export function runStatus(): void {
  const { projectRoot, config } = requireProject();
  const ledger = readLedger(projectRoot, config.model);
  const t = ledger.totals;
  const files = countMapEntries(readTextOr(brain(projectRoot).map));
  const vectors = new VectorStore(brain(projectRoot).vectors).size();
  const pending = peekQueue(projectRoot).length;

  console.log(chalk.bold.cyan("\nPackMind - ") + chalk.bold(path.basename(projectRoot)));
  console.log(`  model:     ${ledger.model}`);
  console.log(`  map:       ${files} files`);
  console.log(`  recall:    ${vectors} vectors indexed` + (pending ? chalk.dim(` (${pending} queued)`) : ""));
  console.log(`  sessions:  ${t.sessions}`);
  console.log(`  reads:     ${t.reads}  ` + chalk.dim(`(${t.dedupedReads} re-reads avoided, ${t.mapHits} map hits)`));
  console.log(`  writes:    ${t.writes}`);
  console.log(`  tokens:    ${t.inputTokens.toLocaleString()} in / ${t.outputTokens.toLocaleString()} out`);
  console.log(`  ${chalk.bold("cost:")}      ${chalk.green("$" + totalCost(ledger).toFixed(4))} ` +
    chalk.dim(`($${t.inputCost.toFixed(4)} in / $${t.outputCost.toFixed(4)} out)`));
  console.log("");
}
