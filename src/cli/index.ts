import { Command } from "commander";
import { pkgVersion } from "./locate.js";
import { runInit } from "./init.js";
import { runScan } from "./scan.js";
import { runStatus } from "./status.js";
import { runIndex } from "./index-cmd.js";
import { runRecall } from "./recall-cmd.js";
import { runSolutions } from "./solutions-cmd.js";
import { runPolicyCheck } from "./policy-cmd.js";
import { runPracticeList, runPracticeAdd, runPracticeRemove, runPracticeExplain } from "./practice-cmd.js";
import { runDoctor } from "./doctor.js";
import { runUpdate } from "./update.js";
import { runUpgrade } from "./upgrade-cmd.js";
import { runMcp } from "./mcp-cmd.js";
import { runDashboard } from "./dashboard-cmd.js";
import { runInsights } from "./insights-cmd.js";
import { runMaintain } from "./maintain-cmd.js";
import { runResume } from "./resume-cmd.js";
import { runBackup, runRestore } from "./backup-cmd.js";
import { runDebt } from "./debt-cmd.js";
import { runChanges, runReconcile } from "./changes-cmd.js";

export function createProgram(): Command {
  const program = new Command();
  program
    .name("packmind")
    .description("A second brain for Claude Code: project memory, estimated token & cost activity, semantic recall, and active guardrails.")
    .version(pkgVersion());

  program.command("init").description("Initialize .packmind/, register hooks and the MCP server").action(runInit);

  program
    .command("scan")
    .description("Rebuild the project map (map.md)")
    .option("--check", "Exit 1 if the map is stale (compares content, not just count)")
    .option("--exact", "Reconcile token counts via Anthropic count-tokens (needs ANTHROPIC_API_KEY)")
    .action((o) => runScan(o));

  program.command("status").description("Token usage, dollar cost, and project health").action(runStatus);

  program.command("insights").description("Where tokens go and what PackMind saved").action(runInsights);

  program
    .command("maintain")
    .description("One-shot upkeep (reconcile, scan, recall queue, archive journal, prune) - safe under cron")
    .option("--quiet", "Suppress success output (errors still go to stderr)")
    .option("--keep-backups <n>", "How many backups to keep, 1-1000 (default 10)")
    .action(async (o) => {
      process.exitCode = await runMaintain(o);
    });

  program
    .command("resume")
    .description("Resume a rate-limited Claude Code session (claude --resume <session-id>)")
    .option("--session <id>", "Which session to resume (required when several tickets exist)")
    .option("--wait", "Wait in the foreground until the recorded reset time, then launch")
    .action(async (o) => {
      process.exitCode = await runResume(o);
    });

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

  program.command("debt").description("List `packmind:` deferred-shortcut markers (lean-mode debt ledger)").action(runDebt);

  program
    .command("changes")
    .description("Show the current session's net change set (add/modify/delete/rename)")
    .option("--session <id>", "Which session (required when several are active)")
    .option("--json", "Output the raw ChangeSetV1 JSON")
    .action((o) => runChanges(o));
  program
    .command("reconcile")
    .description("Force a full change reconciliation and sync map + recall")
    .option("--session <id>", "Which session (required when several are active)")
    .option("--json", "Output the raw ChangeSetV1 JSON")
    .action((o) => runReconcile(o));

  const policy = program.command("policy").description("Guardrail policy");
  policy.command("check").description("Lint policy.json").action(runPolicyCheck);

  const practice = program.command("practice").description("Composable practice packs (tests, CI, release, security reflexes)");
  practice.command("list").description("List bundled packs and which are active").action(runPracticeList);
  practice.command("add <pack>").description("Activate a practice pack").action((p) => runPracticeAdd(p));
  practice.command("remove <pack>").description("Deactivate a practice pack").action((p) => runPracticeRemove(p));
  practice.command("explain <path>").description("Show which rules/checks apply to a path").action((p) => runPracticeExplain(p));

  program
    .command("update")
    .description("Update registered projects (preserves config.json)")
    .option("--dry-run", "Show what would change")
    .option("--list", "List registered projects")
    .option("--project <name>", "Only the matching project")
    .action((o) => runUpdate(o));

  program
    .command("upgrade")
    .description("Upgrade PackMind itself to the latest published version")
    .option("--check", "Only report whether a newer version exists (no changes)")
    .action((o) => runUpgrade(o));

  program
    .command("doctor")
    .description("Diagnose projects, hooks, and MCP registration")
    .option("--fix", "Repair what is safely repairable (e.g. remove a maintain lock older than 6h)")
    .action((o) => runDoctor(o));

  program.command("mcp").description("Run the PackMind MCP server (stdio)").action(() => runMcp());

  program
    .command("dashboard")
    .description("Open the local web dashboard (loopback only, token-protected)")
    .option("--port <port>", "Preferred port (default 7878)")
    .option("--no-open", "Don't auto-open the browser")
    .action((o) => runDashboard(o));

  return program;
}
