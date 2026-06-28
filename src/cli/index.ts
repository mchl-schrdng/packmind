import { Command } from "commander";
import { pkgVersion } from "./locate.js";
import { runInit } from "./init.js";
import { runScan } from "./scan.js";
import { runStatus } from "./status.js";
import { runIndex } from "./index-cmd.js";
import { runRecall } from "./recall-cmd.js";
import { runSolutions } from "./solutions-cmd.js";
import { runPolicyCheck } from "./policy-cmd.js";
import { runDoctor } from "./doctor.js";
import { runUpdate } from "./update.js";
import { runMcp } from "./mcp-cmd.js";
import { runDashboard } from "./dashboard-cmd.js";
import { runInsights } from "./insights-cmd.js";
import { runMaintain } from "./maintain-cmd.js";
import { runBackup, runRestore } from "./backup-cmd.js";

export function createProgram(): Command {
  const program = new Command();
  program
    .name("packmind")
    .description("A second brain for Claude Code: project memory, real token & cost accounting, semantic recall, and active guardrails.")
    .version(pkgVersion());

  program.command("init").description("Initialize .packmind/, register hooks and the MCP server").action(runInit);

  program
    .command("scan")
    .description("Rebuild the project map (map.md)")
    .option("--check", "Exit 1 if the map is stale")
    .action((o) => runScan(o));

  program.command("status").description("Token usage, dollar cost, and project health").action(runStatus);

  program.command("insights").description("Where tokens go and what PackMind saved").action(runInsights);

  program
    .command("maintain")
    .description("One-shot upkeep (scan, reindex, archive journal, prune backups) — cron-friendly")
    .option("--quiet", "Suppress output (for unattended/cron runs)")
    .option("--keep-backups <n>", "How many backups to keep (default 10)")
    .action((o) => runMaintain(o));

  program
    .command("backup")
    .description("Snapshot .packmind/ to ~/.packmind/backups")
    .option("--list", "List existing backups")
    .action((o) => runBackup(o));

  program
    .command("restore [timestamp]")
    .description("Restore .packmind/ from a backup (omit timestamp to list)")
    .action((ts) => runRestore(ts));

  program.command("index").description("Build the local semantic recall index").action(() => runIndex());
  program.command("recall <query...>").description("Search project memory semantically")
    .action((q: string[]) => runRecall(q.join(" ")));

  program.command("solutions <term>").description("Search recorded bug solutions").action((t) => runSolutions(t));

  const policy = program.command("policy").description("Guardrail policy");
  policy.command("check").description("Lint policy.json").action(runPolicyCheck);

  program
    .command("update")
    .description("Update registered projects (preserves config.json)")
    .option("--dry-run", "Show what would change")
    .option("--list", "List registered projects")
    .option("--project <name>", "Only the matching project")
    .action((o) => runUpdate(o));

  program.command("doctor").description("Diagnose projects, hooks, and MCP registration").action(runDoctor);

  program.command("mcp").description("Run the PackMind MCP server (stdio)").action(() => runMcp());

  program
    .command("dashboard")
    .description("Open the local web dashboard (loopback only, token-protected)")
    .option("--port <port>", "Preferred port (default 7878)")
    .option("--no-open", "Don't auto-open the browser")
    .action((o) => runDashboard(o));

  return program;
}
