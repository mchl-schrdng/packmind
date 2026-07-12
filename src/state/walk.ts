import * as fs from "node:fs";
import * as path from "node:path";
import ignore, { type Ignore } from "ignore";
import { relativePosix } from "../util/paths.js";
import { looksSecret } from "../guard/secrets.js";
import type { Config } from "./schema.js";

export const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".jar",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".mp3", ".mp4", ".avi", ".mov", ".webm", ".ogg", ".flac",
  ".sqlite", ".db", ".lock",
]);

export interface WalkedFile {
  abs: string;
  rel: string;
}

/** A `.gitignore` matcher plus the posix rel-dir ("" for root) it applies under. */
interface ScopedIgnore {
  prefix: string;
  ig: Ignore;
}

/**
 * Apply the stacked `.gitignore` matchers to a project-relative posix path,
 * honoring gitignore precedence: deeper files override shallower, and a `!`
 * negation can re-include a path a parent ignored (last definite match wins).
 */
function isIgnored(rel: string, matchers: ScopedIgnore[]): boolean {
  let ignored = false;
  for (const m of matchers) {
    const under = m.prefix === "" || rel === m.prefix || rel.startsWith(m.prefix + "/");
    if (!under) continue;
    const sub = m.prefix === "" ? rel : rel.slice(m.prefix.length + 1);
    if (!sub) continue;
    const r = m.ig.test(sub);
    if (r.ignored) ignored = true;
    else if (r.unignored) ignored = false;
  }
  return ignored;
}

/**
 * Walk the project, yielding text source files. Honors `.gitignore` at every
 * level (not just the repo root), the config exclude list, the secrets denylist,
 * a per-file size cap, and a max-file cap. Used by both the map scanner and the
 * recall indexer so they always agree on which files exist.
 *
 * packmind: this reads nested `.gitignore` files during descent but does not yet
 * consult `.git/info/exclude` or a global core.excludesFile - defer to git-native
 * enumeration (git ls-files --exclude-standard) in the sessions/scale release.
 */
export function walkProject(projectRoot: string, config: Config): WalkedFile[] {
  const c = config.map;
  // .git and .packmind are always pruned, independent of gitignore handling.
  const excluded = new Set([...c.excludeDirs, ".git", ".packmind"]);
  const results: WalkedFile[] = [];

  const walk = (dir: string, matchers: ScopedIgnore[]): void => {
    if (results.length >= c.maxFiles) return;

    // A `.gitignore` here applies to this directory's subtree; push it onto the
    // stack the children inherit.
    let local = matchers;
    if (c.respectGitignore) {
      try {
        const text = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
        const relDir = relativePosix(projectRoot, dir);
        local = [...matchers, { prefix: relDir === "." ? "" : relDir, ig: ignore().add(text) }];
      } catch {
        /* no .gitignore at this level */
      }
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= c.maxFiles) return;
      const abs = path.join(dir, entry.name);
      const rel = relativePosix(projectRoot, abs);
      if (c.respectGitignore && isIgnored(entry.isDirectory() ? rel + "/" : rel, local)) continue;

      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        walk(abs, local);
      } else if (entry.isFile()) {
        if (BINARY_EXT.has(path.extname(entry.name).toLowerCase())) continue;
        if (looksSecret(entry.name, c.extraSecretGlobs, rel)) continue;
        try {
          if (fs.statSync(abs).size > 1_048_576) continue;
        } catch {
          continue;
        }
        results.push({ abs, rel });
      }
    }
  };

  walk(projectRoot, []);
  return results;
}
