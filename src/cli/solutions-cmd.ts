import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { readJsonOr } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";

interface Solution {
  id: string;
  error?: string;
  cause?: string;
  fix?: string;
  tags?: string[];
}

export function runSolutions(term: string): void {
  const { projectRoot } = requireProject();
  const all = readJsonOr<Solution[]>(brain(projectRoot).solutions, []);
  const q = term.toLowerCase();
  const hits = all.filter((s) =>
    [s.error, s.cause, s.fix, ...(s.tags ?? [])].filter(Boolean).join(" ").toLowerCase().includes(q),
  );
  if (hits.length === 0) {
    console.log(chalk.dim(`No solutions matching "${term}".`));
    return;
  }
  for (const s of hits) {
    console.log(chalk.bold(`\n${s.id}`) + (s.tags?.length ? chalk.dim(`  [${s.tags.join(", ")}]`) : ""));
    if (s.error) console.log(`  error: ${s.error}`);
    if (s.cause) console.log(`  cause: ${s.cause}`);
    if (s.fix) console.log(`  fix:   ${chalk.green(s.fix)}`);
  }
  console.log("");
}
