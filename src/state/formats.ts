/**
 * Parsers and serializers for PackMind's human-readable brain files.
 *
 * Every split is CRLF-tolerant (`/\r?\n/`) so files authored on Windows or with
 * `core.autocrlf=true` round-trip cleanly. This module is the single source of
 * truth for these formats; the standalone hook runtime keeps a mirror that is
 * verified identical by a parity test.
 */

export interface MapEntry {
  /** File name within its section directory. */
  file: string;
  description: string;
  tokens: number;
  /** Optional estimated USD cost to read the file once. */
  cost?: number;
}

export function lines(text: string): string[] {
  return text.split(/\r?\n/);
}

const SECTION = /^##\s+(.+?)\s*$/;
// `- `name` · ~123 tok[ · $0.0012] - description`
const ENTRY = /^-\s+`([^`]+)`\s+·\s+~(\d+)\s+tok(?:\s+·\s+\$([\d.]+))?(?:\s+—\s+(.*\S))?\s*$/;

export function parseMap(text: string): Map<string, MapEntry[]> {
  const out = new Map<string, MapEntry[]>();
  let section = "";
  for (const line of lines(text)) {
    const s = line.match(SECTION);
    if (s) {
      section = s[1].trim();
      if (!out.has(section)) out.set(section, []);
      continue;
    }
    if (!section) continue;
    const e = line.match(ENTRY);
    if (e) {
      out.get(section)!.push({
        file: e[1],
        tokens: parseInt(e[2], 10),
        cost: e[3] ? Number(e[3]) : undefined,
        description: e[4] ? e[4].trim() : "",
      });
    }
  }
  return out;
}

export interface MapMeta {
  fileCount: number;
  updated: string;
}

export function serializeMap(sections: Map<string, MapEntry[]>, meta: MapMeta): string {
  const out: string[] = [
    "# Project Map",
    "",
    `_Maintained by PackMind · ${meta.fileCount} files · updated ${meta.updated}_`,
    "",
  ];
  for (const key of [...sections.keys()].sort()) {
    const entries = sections.get(key)!;
    if (entries.length === 0) continue;
    out.push(`## ${key}`, "");
    for (const e of [...entries].sort((a, b) => a.file.localeCompare(b.file))) {
      const cost = e.cost && e.cost > 0 ? ` · $${e.cost.toFixed(4)}` : "";
      const desc = e.description ? ` — ${e.description}` : "";
      out.push(`- \`${e.file}\` · ~${e.tokens} tok${cost}${desc}`);
    }
    out.push("");
  }
  return out.join("\n");
}

/**
 * Extract entries under a `## Never Do` heading in knowledge.md so the write
 * guard can warn before a known-bad pattern is reintroduced. CRLF-safe.
 */
export function parseNeverDo(knowledge: string): string[] {
  const result: string[] = [];
  let active = false;
  for (const line of lines(knowledge)) {
    if (/^##\s+/.test(line)) {
      active = /^##\s+Never\s*Do\b/i.test(line);
      continue;
    }
    if (!active) continue;
    const m = line.match(/^[-*]\s+(?:\[[\d-]+\]\s*)?(.+?)\s*$/);
    if (m) result.push(m[1]);
  }
  return result;
}
