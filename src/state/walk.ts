import * as fs from "node:fs";
import * as path from "node:path";
import ignore from "ignore";
import { relativePosix } from "../util/paths.js";
import { looksSecret } from "../guard/secrets.js";
import type { Config } from "./schema.js";

const BINARY_EXT = new Set([
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

/**
 * Walk the project, yielding text source files. Honors `.gitignore`, the config
 * exclude list, the secrets denylist, a per-file size cap, and a max-file cap.
 * Used by both the map scanner and the recall indexer so they always agree on
 * which files exist.
 */
export function walkProject(projectRoot: string, config: Config): WalkedFile[] {
  const c = config.map;
  const ig = ignore().add([".git", ".packmind"]);
  if (c.respectGitignore) {
    try {
      ig.add(fs.readFileSync(path.join(projectRoot, ".gitignore"), "utf8"));
    } catch {
      /* no .gitignore */
    }
  }
  const excluded = new Set(c.excludeDirs);
  const results: WalkedFile[] = [];

  const walk = (dir: string): void => {
    if (results.length >= c.maxFiles) return;
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
      if (c.respectGitignore && ig.ignores(entry.isDirectory() ? rel + "/" : rel)) continue;

      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        walk(abs);
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

  walk(projectRoot);
  return results;
}
