import * as fs from "node:fs";
import { walkProject } from "./walk.js";
import type { Config } from "./schema.js";

export interface DebtItem {
  file: string; // project-relative path
  line: number; // 1-based
  note: string; // text after the `packmind:` marker
}

// A deferred-shortcut marker: a code comment leader (//, #, --, ;, /*, * ),
// then a lowercase `packmind:`, then the note. Lowercase is deliberate so the
// uppercase `PACKMIND:START`/`END` wiring sentinels are never harvested.
const MARKER = /^\s*(?:\/\/|#{1,6}|--|;{1,3}|\/\*|\*)\s*packmind:\s*(.+?)\s*(?:\*\/\s*)?$/;

/**
 * Scan project source for `packmind:` deferred-shortcut markers (the lean-mode
 * debt convention) and return them as a ledger. Reuses walkProject, so it honors
 * the same gitignore / secret / size filters as the map and recall index.
 */
export function harvestDebt(projectRoot: string, config: Config): DebtItem[] {
  const items: DebtItem[] = [];
  for (const { abs, rel } of walkProject(projectRoot, config)) {
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("packmind:")) continue; // cheap pre-filter
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(MARKER);
      if (m) items.push({ file: rel, line: i + 1, note: m[1] });
    }
  }
  return items;
}
