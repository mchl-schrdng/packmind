import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { brain } from "./files.js";
import { userRoot } from "../util/platform.js";

/** Root for all project backups: ~/.packmind/backups/<project>/<timestamp>/ */
function backupsRoot(): string {
  return path.join(userRoot(), "backups");
}

/** Per-project backup namespace. Includes a short hash of the FULL resolved
 * path so two projects sharing a basename (e.g. two "app" folders) never share
 * a backup namespace. */
function projectBackupDir(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  const hash = crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 8);
  return path.join(backupsRoot(), `${path.basename(resolved)}-${hash}`);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Snapshot the project's `.packmind/` into a timestamped backup. The large,
 * fully-regenerable vector index is skipped (rebuild with `packmind index`),
 * along with transient lock/temp files. Returns the backup path.
 */
export function createSnapshot(projectRoot: string, label?: string): string {
  const src = brain(projectRoot).dir;
  const dest = path.join(projectBackupDir(projectRoot), label ?? timestamp());
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, {
    recursive: true,
    filter: (from) => {
      const base = path.basename(from);
      if (base.endsWith(".lock") || base.endsWith(".tmp")) return false;
      if (from.endsWith(`${path.sep}recall${path.sep}vectors.json`)) return false;
      return true;
    },
  });
  return dest;
}

export function listSnapshots(projectRoot: string): string[] {
  try {
    return fs
      .readdirSync(projectBackupDir(projectRoot))
      .filter((d) => fs.statSync(path.join(projectBackupDir(projectRoot), d)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

export function restoreSnapshot(projectRoot: string, label: string): boolean {
  const src = path.join(projectBackupDir(projectRoot), label);
  if (!fs.existsSync(src)) return false;
  // Restore EXACTLY: clear the current brain first so files created after the
  // snapshot (stale policy.json, usage.json, archives, vectors) don't survive.
  const dest = brain(projectRoot).dir;
  try {
    fs.rmSync(dest, { recursive: true, force: true });
  } catch {
    /* nothing to clear */
  }
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

/** Keep only the most recent `keep` snapshots; returns how many were removed. */
export function pruneSnapshots(projectRoot: string, keep: number): number {
  const dir = projectBackupDir(projectRoot);
  const all = listSnapshots(projectRoot);
  const toRemove = all.slice(0, Math.max(0, all.length - keep));
  for (const d of toRemove) {
    try {
      fs.rmSync(path.join(dir, d), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
  return toRemove.length;
}
