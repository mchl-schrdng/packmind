import * as fs from "node:fs";
import * as path from "node:path";
import {
  requireState,
  projectRoot,
  brainPath,
  readText,
  readSession,
  writeSession,
  newSession,
  parseMap,
  samePath,
  parseInput,
  readStdin,
  emitContext,
} from "./runtime.js";

function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  requireState();
  const root = projectRoot();
  const input = parseInput(await readStdin());
  const filePath = input?.tool_input?.file_path as string | undefined;
  if (!filePath) process.exit(0);

  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (rel.startsWith(".packmind/")) process.exit(0);

  const session = readSession() ?? newSession("s-adhoc");
  const notes: string[] = [];
  const cur = mtime(abs);
  const prior = session.reads[rel];

  // Re-read warning only when the file is unchanged since the last read.
  if (prior && prior.count > 0 && cur > 0 && cur <= prior.mtime) {
    session.dedupedReads++;
    notes.push(`Already read \`${rel}\` this session and it's unchanged (~${prior.tokens} tok) — re-reading is usually wasteful.`);
  }

  // Map lookup with exact path comparison.
  const map = parseMap(readText(brainPath("map.md")));
  let described = false;
  for (const [section, entries] of map) {
    for (const e of entries) {
      const entryRel = (section === "./" ? "" : section) + e.file;
      if (samePath(root, path.resolve(root, entryRel), abs)) {
        if (e.description) notes.push(`map.md: \`${rel}\` — ${e.description} (~${e.tokens} tok)`);
        described = true;
        break;
      }
    }
    if (described) break;
  }
  described ? session.mapHits++ : session.mapMisses++;

  session.reads[rel] = {
    count: (prior?.count ?? 0) + 1,
    tokens: prior?.tokens ?? 0,
    cost: prior?.cost ?? 0,
    mtime: cur,
    first: prior?.first ?? new Date().toISOString(),
  };
  writeSession(session);
  emitContext("PreToolUse", notes.join(" "));
}

main().catch(() => process.exit(0));
