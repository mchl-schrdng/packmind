import * as path from "node:path";
import { brain } from "./files.js";
import { readTextOr, writeText, appendLine } from "../util/fs-atomic.js";

const MAX_JOURNAL_LINES = 1500;
const KEEP_JOURNAL_LINES = 600;

/**
 * Keep journal.md from growing without bound: once it exceeds a threshold, move
 * the oldest entries into journal.archive.md and keep the recent tail. Returns
 * the number of lines archived (0 if no action needed). Non-destructive — the
 * archived lines are appended, never dropped.
 */
export function consolidateJournal(projectRoot: string): number {
  const b = brain(projectRoot);
  const lines = readTextOr(b.journal).split(/\r?\n/);
  if (lines.length <= MAX_JOURNAL_LINES) return 0;

  const header = lines.slice(0, 3);
  const body = lines.slice(3);
  const cut = body.length - KEEP_JOURNAL_LINES;
  const archived = body.slice(0, cut);
  const kept = body.slice(cut);

  appendLine(path.join(b.dir, "journal.archive.md"), archived.join("\n") + "\n");
  writeText(
    b.journal,
    [...header, "", `> (${cut} older lines archived to journal.archive.md)`, "", ...kept].join("\n"),
  );
  return cut;
}
