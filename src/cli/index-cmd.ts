import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { buildIndex } from "../recall/indexer.js";
import { LocalEmbedder } from "../recall/embedder.js";

export async function runIndex(): Promise<void> {
  const { projectRoot, config } = requireProject();
  if (!config.recall.enabled) {
    console.error(chalk.yellow("Recall is disabled in config (recall.enabled = false)."));
    return;
  }
  console.log(chalk.dim("Building semantic index locally (first run downloads the embedding model)…"));
  const embedder = new LocalEmbedder(config.recall.embedModel);
  const count = await buildIndex(projectRoot, config, embedder);
  console.log(chalk.cyan(`✓ Indexed ${count} chunks into .packmind/recall/`));
}
