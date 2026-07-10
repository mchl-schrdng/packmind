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
  // Only accept a label `listSnapshots` actually returned. That rejects path
  // separators, "..", absolute paths, and anything outside this project's backup
  // namespace BEFORE we touch the filesystem - a raw `path.join(dir, label)`
  // would happily resolve `../../elsewhere` and let restore copy an unrelated
  // directory over the brain.
  if (!listSnapshots(projectRoot).includes(label)) return false;

  const backupDir = projectBackupDir(projectRoot);
  const src = path.join(backupDir, label);
  // Defense in depth: confirm the resolved source really lives under the backup
  // namespace (guards against a symlinked snapshot entry).
  let realSrc: string;
  let realBackupDir: string;
  try {
    realSrc = fs.realpathSync(src);
    realBackupDir = fs.realpathSync(backupDir);
  } catch {
    return false;
  }
  const inside = path.relative(realBackupDir, realSrc);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) return false;

  const dest = brain(projectRoot).dir;
  // A pre-restore emergency snapshot is mandatory: if we can't back up the
  // current brain, we refuse rather than risk an unrecoverable overwrite.
  if (fs.existsSync(dest)) {
    try {
      createSnapshot(projectRoot, `pre-restore-${timestamp()}`);
    } catch {
      return false;
    }
  }

  // Restore transactionally: copy into a staging sibling, then swap it in. The
  // original brain is moved aside (not deleted) until the swap succeeds, so a
  // crash or copy failure mid-restore can't leave the brain half-replaced.
  const suffix = crypto.randomBytes(5).toString("hex");
  const staging = `${dest}.restore-${suffix}.tmp`;
  const old = `${dest}.old-${suffix}`;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(realSrc, staging, { recursive: true });
    if (fs.existsSync(dest)) fs.renameSync(dest, old);
    fs.renameSync(staging, dest);
    fs.rmSync(old, { recursive: true, force: true });
    return true;
  } catch {
    // Roll back: if we moved the original aside but never swapped in the new
    // copy, put the original back so the brain is never lost.
    try {
      if (fs.existsSync(old) && !fs.existsSync(dest)) fs.renameSync(old, dest);
    } catch {
      /* best effort */
    }
    fs.rmSync(staging, { recursive: true, force: true });
    return false;
  }
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
