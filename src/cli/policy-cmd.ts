import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { readJsonOr } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";
import { validateRule, type Rule } from "../guard/policy.js";

export function runPolicyCheck(): void {
  const { projectRoot } = requireProject();
  const policy = readJsonOr<{ rules?: Rule[] }>(brain(projectRoot).policy, {});
  const rules = policy.rules ?? [];
  let problems = 0;

  console.log(chalk.bold.cyan(`\nPolicy: ${rules.length} rule(s)\n`));
  for (const r of rules) {
    const issues = validateRule(r);
    if (issues.length) {
      problems++;
      console.log(`  ${chalk.red("✗")} ${r.id || "(no id)"} — ${issues.join("; ")}`);
    } else {
      console.log(`  ${chalk.green("✓")} ${r.id} (${r.severity})`);
    }
  }
  console.log("");
  if (problems) process.exit(1);
}
