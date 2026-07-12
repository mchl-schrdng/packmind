import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { looksSecret } from "../guard/secrets.js";
import { confineToRoot } from "../guard/path-guard.js";
import { BINARY_EXT } from "../state/walk.js";
import type { Config } from "../state/schema.js";

const MAX_SIZE = 1_048_576;

/**
 * Whether a project-relative path may enter the change set. Mirrors the file
 * rules of `walkProject` for a SINGLE path (so it also works for deleted files
 * that no longer exist on disk): never `.packmind`/`.git`, never an excluded
 * directory, never binary or secret, never out of root, and (when on disk)
 * never over the size cap. Gitignore itself is enforced upstream: git status
 * already omits ignored files, and the non-git manifest is built from
 * `walkProject`.
 */
export function isEligiblePath(root: string, rel: string, config: Config): boolean {
  if (!rel) return false;
  const posix = rel.split(path.sep).join("/");
  if (posix.startsWith("../") || posix === ".." || path.isAbsolute(posix)) return false;
  if (posix === ".packmind" || posix.startsWith(".packmind/")) return false;
  if (posix === ".git" || posix.startsWith(".git/")) return false;

  const segments = posix.split("/");
  const excluded = new Set(config.map.excludeDirs);
  if (segments.slice(0, -1).some((s) => excluded.has(s))) return false;

  const base = segments[segments.length - 1];
  if (BINARY_EXT.has(path.extname(base).toLowerCase())) return false;
  if (looksSecret(base, config.map.extraSecretGlobs, posix)) return false;

  // Symlink-aware confinement: reject a path whose REAL location (following
  // symlinks) escapes the project root, so an in-project symlink can't leak
  // external content into the change set / map / recall.
  if (confineToRoot(root, rel) === null) return false;

  try {
    const st = fs.statSync(path.join(root, rel));
    if (st.isFile() && st.size > MAX_SIZE) return false;
  } catch {
    /* absent (a delete): still eligible so we can record its removal */
  }
  return true;
}

/** Content fingerprint of a file, or null if it can't be read (e.g. deleted). */
export function fingerprint(abs: string): string | null {
  try {
    if (fs.lstatSync(abs).isSymbolicLink()) return null; // never fingerprint through a symlink
    return crypto.createHash("sha1").update(fs.readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}
