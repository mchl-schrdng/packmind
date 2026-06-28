import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { readJsonOr } from "../util/fs-atomic.js";
import { loadConfig } from "../state/schema.js";
import { brain } from "../state/files.js";
import { MANAGED_BY } from "../adapters/claude-code.js";
import { pruneRegistry } from "./registry.js";

const HOOK_SCRIPTS = [
  "runtime.js", "session-start.js", "prompt-submit.js", "pre-read.js",
  "post-read.js", "pre-write.js", "post-write.js", "stop.js",
];

export function runDoctor(): void {
  console.log(chalk.bold.cyan("\nPackMind doctor\n"));
  const projects = pruneRegistry();
  if (projects.length === 0) {
    console.log(`  ${chalk.yellow("!")} No registered projects. Run \`packmind init\`.`);
    return;
  }
  console.log(`  ${chalk.green("✓")} ${projects.length} registered project(s).`);

  for (const p of projects) {
    console.log("\n" + chalk.bold(p.name) + chalk.dim(`  ${p.root}`));
    const b = brain(p.root);

    const missing = HOOK_SCRIPTS.filter((s) => !fs.existsSync(path.join(b.hooksDir, s)));
    ok(missing.length === 0, missing.length === 0 ? "all hook scripts present" : `missing: ${missing.join(", ")}`);

    const config = loadConfig(b.config);
    const settings = readJsonOr<any>(path.join(p.root, config.claude.settingsPath), {});
    const tagged = Object.values(settings.hooks ?? {}).flat().filter((g: any) => g?._managedBy === MANAGED_BY);
    ok(tagged.length >= 7, `${tagged.length} tagged hook entries`);

    const mcp = readJsonOr<any>(path.join(p.root, ".mcp.json"), {});
    ok(Boolean(mcp.mcpServers?.packmind), "packmind MCP server registered");

    let validConfig = true;
    try {
      JSON.parse(fs.readFileSync(b.config, "utf8"));
    } catch {
      validConfig = false;
    }
    ok(validConfig, "config.json valid");
  }
  console.log("");
}

function ok(pass: boolean, msg: string): void {
  console.log(`  ${pass ? chalk.green("✓") : chalk.yellow("!")} ${msg}`);
}
