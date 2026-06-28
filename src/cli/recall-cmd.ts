import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { recall } from "../recall/indexer.js";
import { LocalEmbedder } from "../recall/embedder.js";

export async function runRecall(query: string): Promise<void> {
  const { projectRoot, config } = requireProject();
  const embedder = new LocalEmbedder(config.recall.embedModel);
  const hits = await recall(projectRoot, config, embedder, query);
  if (hits.length === 0) {
    console.log(chalk.dim("No matches. Run `packmind index` if you haven't yet."));
    return;
  }
  for (const h of hits) {
    console.log(
      chalk.bold.cyan(`\n[${h.kind}] `) + chalk.dim(h.source) + chalk.green(`  ${h.score.toFixed(2)}`),
    );
    console.log("  " + h.text.slice(0, 400).replace(/\n/g, "\n  "));
  }
  console.log("");
}
