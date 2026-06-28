import * as fs from "node:fs";
import {
  requireState,
  brainPath,
  readText,
  appendLine,
  writeSession,
  newSession,
  emitContext,
} from "./runtime.js";

function clearStale(dir: string): void {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".tmp") || name.endsWith(".lock")) {
        try {
          fs.rmSync(`${dir}/${name}`, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* dir may not exist */
  }
}

function main(): void {
  requireState();
  clearStale(brainPath("hooks"));
  clearStale(brainPath("state"));

  const now = new Date();
  const id = `s-${now.toISOString().slice(0, 19).replace(/[:T]/g, "")}`;
  writeSession(newSession(id));

  appendLine(
    brainPath("journal.md"),
    `\n## ${id} — ${now.toISOString()}\n\n| Time | Action | File | Tokens |\n|------|--------|------|--------|\n`,
  );

  const parts: string[] = [];
  const handoff = readText(brainPath("handoff.md")).trim();
  // Only surface a handoff that has real content (skip the seed placeholder).
  if (handoff && !/no session recorded yet/i.test(handoff)) {
    parts.push("Session handoff (where we left off):\n" + handoff);
  }
  parts.push(
    "PackMind is active. Use the `recall` MCP tool to search project memory, and `record_solution`/`remember` to capture fixes and decisions. Check `.packmind/map.md` before reading files.",
  );
  emitContext("SessionStart", parts.join("\n\n"));
}

main();
