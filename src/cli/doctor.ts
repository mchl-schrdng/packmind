import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import { readJsonOr } from "../util/fs-atomic.js";
import { loadConfig } from "../state/schema.js";
import { brain } from "../state/files.js";
import { buildHookMap, HOOK_SCRIPTS } from "../adapters/claude-code.js";
import { pruneRegistry } from "./registry.js";
import { maintainLockDir } from "./maintain-cmd.js";

export function runDoctor(opts: { fix?: boolean } = {}): void {
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
    // Verify the full event -> script matrix, not just a count: every event
    // buildHookMap registers must actually be present in settings.json with its
    // script (this is what catches a hook that's copied but never registered).
    const notRegistered: string[] = [];
    for (const [event, groups] of Object.entries(buildHookMap())) {
      const registered = JSON.stringify(settings.hooks?.[event] ?? []);
      for (const g of groups) {
        for (const h of g.hooks) {
          const script = h.command.match(/([a-z0-9-]+\.js)/)?.[1];
          if (script && !registered.includes(script)) notRegistered.push(`${event}->${script}`);
        }
      }
    }
    ok(
      notRegistered.length === 0,
      notRegistered.length === 0 ? "all lifecycle events registered" : `NOT registered: ${notRegistered.join(", ")}`,
    );

    const mcp = readJsonOr<any>(path.join(p.root, ".mcp.json"), {});
    ok(Boolean(mcp.mcpServers?.packmind), "packmind MCP server registered");

    let validConfig = true;
    try {
      JSON.parse(fs.readFileSync(b.config, "utf8"));
    } catch {
      validConfig = false;
    }
    ok(validConfig, "config.json valid");

    // Stale maintain lock: a crashed cron run can leave maintain.lock behind.
    // maintain itself never steals it; only an explicit --fix removes one, and
    // only when it is older than six hours.
    const lockDir = maintainLockDir(p.root);
    if (fs.existsSync(lockDir)) {
      let ageMs = 0;
      try {
        ageMs = Date.now() - fs.statSync(lockDir).mtimeMs;
      } catch {
        /* vanished between the check and the stat */
      }
      const stale = ageMs > 6 * 60 * 60 * 1000;
      if (stale && opts.fix) {
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
          ok(true, "stale maintain lock removed (>6h)");
        } catch (err) {
          ok(false, `could not remove stale maintain lock: ${(err as Error).message}`);
        }
      } else {
        ok(!stale, stale ? "stale maintain lock (>6h) - run `packmind doctor --fix`" : "maintain lock present (maintenance running)");
      }
    }
  }
  console.log("");
}

function ok(pass: boolean, msg: string): void {
  console.log(`  ${pass ? chalk.green("✓") : chalk.yellow("!")} ${msg}`);
}
