import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { scanProject, scanProjectWith, mapIsStale, type TokenCounter } from "../state/mapper.js";
import { estimateTokens } from "../cost/estimator.js";
import { countTokensExact, exactEnabled } from "../cost/exact.js";

export async function runScan(opts: { check?: boolean; exact?: boolean } = {}): Promise<void> {
  const { projectRoot, config } = requireProject();

  if (opts.check) {
    // Real staleness: compares descriptions, tokens, cost and the file set -
    // not just the file count.
    if (mapIsStale(projectRoot, config)) {
      console.error(chalk.yellow("map.md is stale - run `packmind scan`."));
      process.exit(1);
    }
    console.log(chalk.green("✓ map.md is up to date."));
    return;
  }

  const useExact = opts.exact || exactEnabled(config.cost.exact);
  if (useExact) {
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
    if (!hasKey) {
      console.log(chalk.yellow("Exact counting needs ANTHROPIC_API_KEY - using estimates instead."));
      const count = scanProject(projectRoot, config);
      console.log(chalk.cyan(`✓ Mapped ${count} files into map.md`));
      return;
    }
    // Exact counts via Anthropic's count-tokens API, with a per-file fallback to
    // the local estimate on any failure (network error, rate limit, timeout).
    let exactHits = 0;
    let fellBack = 0;
    const counter: TokenCounter = async (content, hint) => {
      const exact = await countTokensExact(content, config.model);
      if (exact === null) {
        fellBack++;
        return estimateTokens(content, hint);
      }
      exactHits++;
      return exact;
    };
    const count = await scanProjectWith(projectRoot, config, counter);
    // Report honestly: only claim "exact" for the files that actually got it.
    if (exactHits === 0) {
      console.log(chalk.yellow(`✓ Mapped ${count} files into map.md (exact unavailable - all estimated)`));
    } else if (fellBack > 0) {
      console.log(chalk.cyan(`✓ Mapped ${count} files into map.md (${exactHits} exact, ${fellBack} estimated)`));
    } else {
      console.log(chalk.cyan(`✓ Mapped ${count} files into map.md (exact token counts)`));
    }
    return;
  }

  const count = scanProject(projectRoot, config);
  console.log(chalk.cyan(`✓ Mapped ${count} files into map.md`));
}
