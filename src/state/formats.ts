/**
 * Parsers for PackMind's human-readable brain files.
 *
 * Every split is CRLF-tolerant (`/\r?\n/`) so files authored on Windows or with
 * `core.autocrlf=true` round-trip cleanly. This module is the single source of
 * truth for these formats; the standalone hook runtime keeps a mirror that is
 * verified identical by a parity test.
 */

export function lines(text: string): string[] {
  return text.split(/\r?\n/);
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
