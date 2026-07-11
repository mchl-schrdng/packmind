import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { findRoot, isHome } from "../state/project.js";
import { brain } from "../state/files.js";
import { loadConfig } from "../state/schema.js";
import { scanProject } from "../state/mapper.js";
import { registerHooks, registerMcp } from "../adapters/claude-code.js";
import { writeEffective } from "../guard/practices.js";
import { ensureDir } from "../util/paths.js";
import { TEMPLATES_DIR, HOOKS_DIST_DIR, pkgVersion } from "./locate.js";
import { registerProject } from "./registry.js";
import { seedBrainFiles } from "./seed.js";

const ALWAYS_OVERWRITE = ["PACKMIND.md"];
const HOOK_SCRIPTS = [
  "runtime.js", "session-start.js", "session-end.js", "prompt-submit.js", "pre-read.js",
  "post-read.js", "pre-write.js", "post-write.js", "stop.js",
];

function copy(src: string, dest: string): void {
  if (fs.existsSync(src)) fs.writeFileSync(dest, fs.readFileSync(src));
}

function wireClaudeMd(projectRoot: string, claudeMdRel: string): void {
  const target = path.join(projectRoot, claudeMdRel);
  const snippet = fs.readFileSync(path.join(TEMPLATES_DIR, "claude-md-snippet.md"), "utf8");
  let existing = "";
  try {
    existing = fs.readFileSync(target, "utf8");
  } catch {
    /* missing */
  }
  if (existing.includes("PACKMIND:START")) return;
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, existing ? existing.replace(/\s*$/, "\n\n") + snippet : snippet);
}

export function runInit(): void {
  const projectRoot = findRoot();
  if (isHome(projectRoot)) {
    console.error(chalk.red("✗ Refusing to initialize in your home directory. Run inside a project."));
    process.exit(1);
  }

  const b = brain(projectRoot);
  ensureDir(b.hooksDir);
  ensureDir(path.join(b.dir, "state"));
  ensureDir(b.recallDir);

  const fresh = !fs.existsSync(b.config);
  seedBrainFiles(b.dir);
  for (const f of ALWAYS_OVERWRITE) copy(path.join(TEMPLATES_DIR, f), path.join(b.dir, f));

  for (const script of HOOK_SCRIPTS) copy(path.join(HOOKS_DIST_DIR, script), path.join(b.hooksDir, script));
  copy(path.join(TEMPLATES_DIR, "hooks-package.json"), path.join(b.hooksDir, "package.json"));

  const config = loadConfig(b.config);
  registerHooks(path.join(projectRoot, config.claude.settingsPath));
  registerMcp(path.join(projectRoot, ".mcp.json"));
  wireClaudeMd(projectRoot, config.claude.claudeMdPath);
  writeEffective(projectRoot, config); // resolve default + practice packs + local policy

  if (config.map.autoScanOnInit) {
    const count = scanProject(projectRoot, config);
    console.log(chalk.cyan(`• Mapped ${count} files into map.md`));
  }

  registerProject(projectRoot, pkgVersion());

  console.log(
    "\n" + chalk.bold.cyan("PackMind") + ` ${fresh ? "initialized" : "updated"} in ` +
      chalk.bold(path.relative(process.cwd(), projectRoot) || ".") + "\n" +
      `  ${chalk.green("✓")} .packmind/ created (map, knowledge, journal, usage, policy, recall)\n` +
      `  ${chalk.green("✓")} Claude Code hooks registered (tagged _managedBy: packmind)\n` +
      `  ${chalk.green("✓")} packmind MCP server registered in .mcp.json\n\n` +
      `Run ${chalk.bold("packmind index")} to build the semantic index, then use ${chalk.bold("claude")} as normal.\n`,
  );
}
