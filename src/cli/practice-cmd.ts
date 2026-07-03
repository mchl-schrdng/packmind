import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { readJsonOr, writeJson } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";
import { loadConfig, type Config } from "../state/schema.js";
import { listPacks, readPack, resolvePractices, writeEffective } from "../guard/practices.js";
import { evaluateWrite, globToRe } from "../guard/policy.js";

/** List the bundled practice packs, marking the ones active in this project. */
export function runPracticeList(): void {
  const { projectRoot, config } = requireProject();
  const active = new Set(config.guard.practices ?? []);
  const packs = listPacks();
  console.log(chalk.bold.cyan(`\nPractice packs (${active.size} active)\n`));
  if (!packs.length) console.log(chalk.dim("  (none bundled)"));
  for (const name of packs) {
    const pack = readPack(name);
    const on = active.has(name);
    const counts = pack
      ? chalk.dim(`${pack.rules?.length ?? 0} rule(s), ${pack.checks?.length ?? 0} check(s)`)
      : chalk.red("unreadable");
    console.log(`  ${on ? chalk.green("●") : chalk.dim("○")} ${name}  ${counts}`);
  }
  console.log(chalk.dim("\n  ● active   ○ available    `packmind practice add <name>`\n"));
}

function savePractices(projectRoot: string, practices: string[]): Config {
  // Mutate the raw (partial) config so we don't rewrite the whole merged config.
  const raw = readJsonOr<Partial<Config>>(brain(projectRoot).config, {});
  raw.guard = { ...(raw.guard ?? {}), practices } as Config["guard"];
  writeJson(brain(projectRoot).config, raw);
  const config = loadConfig(brain(projectRoot).config);
  writeEffective(projectRoot, config);
  return config;
}

export function runPracticeAdd(name: string): void {
  const { projectRoot, config } = requireProject();
  if (!listPacks().includes(name)) {
    console.error(chalk.red(`✗ Unknown pack "${name}". Run \`packmind practice list\`.`));
    process.exit(1);
  }
  const active = config.guard.practices ?? [];
  if (active.includes(name)) {
    console.log(chalk.dim(`  ${name} is already active.`));
    return;
  }
  savePractices(projectRoot, [...active, name]);
  console.log(`  ${chalk.green("✓")} Activated ${chalk.bold(name)} and refreshed the guard set.`);
}

export function runPracticeRemove(name: string): void {
  const { projectRoot, config } = requireProject();
  const active = config.guard.practices ?? [];
  if (!active.includes(name)) {
    console.log(chalk.dim(`  ${name} is not active.`));
    return;
  }
  savePractices(projectRoot, active.filter((p) => p !== name));
  console.log(`  ${chalk.green("✓")} Deactivated ${chalk.bold(name)} and refreshed the guard set.`);
}

/** Show which rules and session-checks would fire for a given path. */
export function runPracticeExplain(target: string): void {
  const { projectRoot, config } = requireProject();
  const { rules, checks } = resolvePractices(projectRoot, config);
  const rel = target.split(/[\\/]/).join("/");

  console.log(chalk.bold.cyan(`\nGuard for \`${rel}\`\n`));

  // Per-write rules that match on path alone (content rules can't be judged
  // without the actual write, so they're listed separately when their path fits).
  const { findings } = evaluateWrite({ version: 1, rules }, { relPath: rel, content: "", blockSecrets: false, extraSecretGlobs: [] });
  const pathMatches = new Set(findings.map((f) => f.ruleId));
  const contentRules = rules.filter((r) => r.content && !pathMatches.has(r.id) && (!r.pathGlob || globToRe(r.pathGlob).test(rel)));
  for (const f of findings) console.log(`  ${chalk.yellow(f.severity)}  ${f.ruleId} - ${f.message}`);
  for (const r of contentRules) {
    console.log(`  ${chalk.dim(r.severity)}  ${r.id} ${chalk.dim("(fires only if content matches its regex)")}`);
  }

  // Session-level checks whose changedGlobs include this path.
  const relevant = checks.filter((c) => c.changedGlobs.some((g) => globToRe(g).test(rel)));
  if (relevant.length) {
    console.log(chalk.bold("\n  Session checks:"));
    for (const c of relevant) {
      const ev = c.needsEvidence ? chalk.dim(` (satisfy with record_evidence({check:"${c.needsEvidence}"}))`) : "";
      console.log(`  ${chalk.cyan("○")} ${c.id}${ev}\n      ${c.message}`);
    }
  }

  if (!findings.length && !contentRules.length && !relevant.length) {
    console.log(chalk.dim("  No rules or checks apply to this path."));
  }
  console.log("");
}
