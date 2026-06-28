import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { readJsonOr } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";
import type { Rule } from "../guard/policy.js";

export function runPolicyCheck(): void {
  const { projectRoot } = requireProject();
  const policy = readJsonOr<{ rules?: Rule[] }>(brain(projectRoot).policy, {});
  const rules = policy.rules ?? [];
  let problems = 0;

  console.log(chalk.bold.cyan(`\nPolicy: ${rules.length} rule(s)\n`));
  for (const r of rules) {
    const issues: string[] = [];
    if (!r.id) issues.push("missing id");
    if (!r.message) issues.push("missing message");
    if (r.severity !== "warn" && r.severity !== "block") issues.push("severity must be warn|block");
    if (!r.secretFile && !r.pathGlob && !r.content) issues.push("rule matches nothing (need secretFile/pathGlob/content)");
    if (r.content) {
      try {
        new RegExp(r.content);
      } catch {
        issues.push("invalid content regex");
      }
    }
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
