import { Command } from "commander";
import { pkgVersion } from "./locate.js";
import { runInit } from "./init.js";
import { runStatus } from "./status.js";
import { runDoctor } from "./doctor.js";
import { runUpdate } from "./update.js";
import { runMcp } from "./mcp-cmd.js";
import { runResume } from "./resume-cmd.js";

export function createProgram(): Command {
  const program = new Command();
  program
    .name("packmind")
    .description("Resume rate-limited Claude Code sessions and share a committed project memory Claude reads automatically.")
    .version(pkgVersion());

  program.command("init").description("Initialize .packmind/, register hooks and the MCP server").action(runInit);

  program.command("status").description("Project health: brain files, hooks, resume tickets").action(runStatus);

  program
    .command("resume")
    .description("Resume a rate-limited Claude Code session (claude --resume <session-id>)")
    .option("--session <id>", "Which session to resume (required when several tickets exist)")
    .option("--wait", "Wait in the foreground until the recorded reset time, then launch")
    .action(async (o) => {
      process.exitCode = await runResume(o);
    });

  program
    .command("update")
    .description("Update registered projects (preserves config.json)")
    .option("--dry-run", "Show what would change")
    .option("--list", "List registered projects")
    .option("--project <name>", "Only the matching project")
    .action((o) => runUpdate(o));

  program
    .command("doctor")
    .description("Diagnose projects, hooks, and MCP registration")
    .option("--fix", "Repair what is safely repairable (e.g. recover an orphaned resume launch)")
    .action((o) => runDoctor(o));

  program.command("mcp").description("Run the PackMind MCP server (stdio)").action(() => runMcp());

  return program;
}
