import * as fs from "node:fs";
import * as path from "node:path";
import { brain } from "./files.js";
import { userRoot } from "../util/platform.js";

/** Root for all project backups: ~/.packmind/backups/<project>/<timestamp>/ */
export function backupsRoot(): string {
  return path.join(userRoot(), "backups");
}

function projectBackupDir(projectRoot: string): string {
  return path.join(backupsRoot(), path.basename(path.resolve(projectRoot)));
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
  fs.cpSync(src, brain(projectRoot).dir, { recursive: true });
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
