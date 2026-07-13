import chalk from "chalk";
import * as fs from "node:fs";
import * as path from "node:path";
import { requireProject } from "./ctx.js";
import { readJsonOr, readTextOr } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";
import { HOOK_SCRIPTS } from "../adapters/claude-code.js";
import { listTickets } from "../state/resume.js";

export function runStatus(): void {
  const { projectRoot } = requireProject();
  const b = brain(projectRoot);

  const solutions = readJsonOr<unknown[]>(b.solutions, []);
  const knowledgeLines = readTextOr(b.knowledge)
    .split(/\r?\n/)
    .filter((l) => /^- /.test(l)).length;
  const handoff = readTextOr(b.handoff).trim();
  const missingHooks = HOOK_SCRIPTS.filter((s) => !fs.existsSync(path.join(b.hooksDir, s)));
  const tickets = listTickets(projectRoot);

  console.log(chalk.bold.cyan("\nPackMind - ") + chalk.bold(path.basename(projectRoot)));
  console.log(`  knowledge: ${knowledgeLines} entr${knowledgeLines === 1 ? "y" : "ies"}`);
  console.log(`  solutions: ${Array.isArray(solutions) ? solutions.length : 0} recorded fix(es)`);
  console.log(`  handoff:   ${handoff ? "present" : chalk.dim("empty")}`);
  console.log(
    `  hooks:     ${missingHooks.length === 0 ? chalk.green("all present") : chalk.yellow(`missing ${missingHooks.join(", ")}`)}`,
  );
  if (tickets.length) {
    for (const t of tickets) {
      console.log(`  resume:    ${chalk.yellow(t.status)} ticket for session ${t.sessionId}` +
        (t.resetAt ? chalk.dim(` (reset ${t.resetAt})`) : ""));
    }
    console.log(chalk.dim("\n  Run `packmind resume` after the limit resets."));
  }
  console.log("");
}
