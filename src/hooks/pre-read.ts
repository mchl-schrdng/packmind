import * as fs from "node:fs";
import * as path from "node:path";
import {
  requireState,
  projectRoot,
  confineToRoot,
  brainPath,
  readText,
  sessionRawKey,
  updateSession,
  parseMap,
  samePath,
  parseInput,
  readStdin,
  compressNudge,
  emitContext,
} from "./runtime.js";

function mtime(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}
function size(p: string): number {
  try {
    return fs.statSync(p).size;
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

  // Confine to the project: ignore reads of files outside the root so they
  // can't pollute the map/journal or skew accounting.
  if (confineToRoot(root, filePath) === null) process.exit(0);
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  if (rel.startsWith(".packmind/")) process.exit(0);

  const rawKey = sessionRawKey(input);
  if (!rawKey) process.exit(0);
  const notes: string[] = [];
  const cur = mtime(abs);
  const map = parseMap(readText(brainPath("map.md")));

  updateSession(rawKey, (session) => {
    const prior = session.reads[rel];

    // Re-read warning only when the file is unchanged since the last read.
    if (prior && prior.count > 0 && cur > 0 && cur <= prior.mtime) {
      session.dedupedReads++;
      notes.push(`Already read \`${rel}\` this session and it's unchanged (~${prior.tokens} tok) - re-reading is usually wasteful.`);
    }

    // Map lookup with exact path comparison.
    let described = false;
    for (const [section, entries] of map) {
      for (const e of entries) {
        const entryRel = (section === "./" ? "" : section) + e.file;
        if (samePath(root, path.resolve(root, entryRel), abs)) {
          if (e.description) notes.push(`map.md: \`${rel}\` - ${e.description} (~${e.tokens} tok)`);
          described = true;
          break;
        }
      }
      if (described) break;
    }
    described ? session.mapHits++ : session.mapMisses++;

    // Suggest compress() once per session before reading a large non-source file.
    const cnudge = compressNudge(rel, size(abs), session);
    if (cnudge) notes.push(cnudge);

    session.reads[rel] = {
      count: (prior?.count ?? 0) + 1,
      tokens: prior?.tokens ?? 0,
      cost: prior?.cost ?? 0,
      mtime: cur,
      first: prior?.first ?? new Date().toISOString(),
    };
    session.lastEventAt = new Date().toISOString();
  });
  emitContext("PreToolUse", notes.join(" "));
}

main().catch(() => process.exit(0));
