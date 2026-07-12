import * as fs from "node:fs";
import * as path from "node:path";
import {
  requireState,
  projectRoot,
  confineToRoot,
  parseInput,
  readStdin,
  sessionRawKey,
  readSessionFor,
  hookConfig,
  isEligiblePath,
  recordChangeCandidate,
} from "./runtime.js";

/**
 * A watched file changed on disk (add/change/unlink) outside the direct tools.
 * Record an immediate change candidate for the eligible, in-root path. Never
 * blocks and never claims pre-change enforcement; the Stop reconcile corrects
 * the exact kind from the filesystem.
 */
async function main(): Promise<void> {
  requireState();
  const input = parseInput(await readStdin());
  const rawKey = sessionRawKey(input);
  if (!rawKey) process.exit(0);
  const session = readSessionFor(rawKey);
  if (!session) process.exit(0);

  const root = projectRoot();
  const cfg = hookConfig();
  const filePath =
    typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : "";
  if (!filePath) process.exit(0);
  if (confineToRoot(root, filePath) === null) process.exit(0);

  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join("/");
  if (!isEligiblePath(root, rel, cfg.extraSecretGlobs, cfg.excludeDirs)) process.exit(0);

  const event = typeof input.event === "string" ? input.event : typeof input.change_type === "string" ? input.change_type : "";
  const exists = fs.existsSync(path.join(root, rel));
  const kind = event === "unlink" || !exists ? "delete" : event === "add" ? "add" : "modify";

  recordChangeCandidate(root, session, { path: rel, kind }, "file-changed", new Date().toISOString());
}

main().catch(() => process.exit(0));
