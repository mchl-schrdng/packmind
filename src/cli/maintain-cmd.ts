import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { scanProject } from "../state/mapper.js";
import { consolidateJournal } from "../state/maintain.js";
import { refreshFromQueue } from "../recall/indexer.js";
import { LocalEmbedder } from "../recall/embedder.js";
import { pruneSnapshots } from "../state/snapshot.js";
import { pruneStaleSessions, activeSessions } from "../state/session.js";
import { reconcileAndSync } from "../change/service.js";
import { stateFile, ensureDir } from "../util/paths.js";

const STALE_SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const KEEP_BACKUPS_DEFAULT = 10;

/**
 * One-shot, cron-safe maintenance. Exit codes: 0 success, 1 invalid
 * arguments/config, 2 partial failure, 3 another maintenance is active.
 * All validation happens BEFORE any mutation; an exclusive lock directory
 * guarantees two maintains never overlap; backups are only pruned when every
 * earlier step succeeded. Never launches Claude, never consumes Claude
 * tokens, never installs a scheduler.
 */

/** Strict integer 1..1000; undefined -> default 10; anything else -> null. */
export function parseKeepBackups(raw: string | undefined): number | null {
  if (raw === undefined) return KEEP_BACKUPS_DEFAULT;
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 1000 ? n : null;
}

export const MAINTAIN_LOCK_DIRNAME = "maintain.lock";
export function maintainLockDir(root: string): string {
  return stateFile(root, "state", MAINTAIN_LOCK_DIRNAME);
}

/** Atomically create .packmind/state/maintain.lock/ (mkdir is the mutex).
 * Returns null when another maintenance holds it - it is NEVER stolen here;
 * only `doctor --fix` may remove a lock older than six hours. */
export function acquireMaintainLock(root: string): { release(): void } | null {
  const dir = maintainLockDir(root);
  ensureDir(path.dirname(dir));
  try {
    fs.mkdirSync(dir); // non-recursive: EEXIST means someone else runs
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw err;
  }
  const owner = crypto.randomUUID();
  fs.writeFileSync(
    path.join(dir, "lock.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), owner }, null, 2) + "\n",
  );
  return {
    release: () => {
      // Only remove the lock we still own: if doctor --fix reclaimed a stale
      // lock and a newer maintain took its place, deleting blindly here would
      // unlock that live run and let a third maintain overlap it.
      try {
        const current = JSON.parse(fs.readFileSync(path.join(dir, "lock.json"), "utf8")) as { owner?: string };
        if (current?.owner !== owner) return;
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* lock already gone or unreadable: nothing that is ours to remove */
      }
    },
  };
}

export async function runMaintain(opts: { quiet?: boolean; keepBackups?: string } = {}): Promise<number> {
  // 1. Validate configuration and options - before ANY mutation.
  const keep = parseKeepBackups(opts.keepBackups);
  if (keep === null) {
    console.error(chalk.red(`✗ --keep-backups must be an integer between 1 and 1000 (got ${JSON.stringify(opts.keepBackups)})`));
    return 1;
  }
  const { projectRoot, config } = requireProject();

  const say = (m: string) => {
    if (!opts.quiet) console.log(m);
  };
  const failures: string[] = [];
  const step = <T>(name: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (err) {
      failures.push(name);
      console.error(chalk.red(`✗ ${name} failed - ${(err as Error).message.split("\n")[0]}`));
      return undefined;
    }
  };

  // 2. Take the lock.
  const lock = acquireMaintainLock(projectRoot);
  if (!lock) {
    console.error(chalk.red(`✗ another maintenance is already active (${maintainLockDir(projectRoot)} exists). If it crashed >6h ago, run \`packmind doctor --fix\`.`));
    return 3;
  }

  try {
    // 3. Reconcile active sessions.
    step("reconcile sessions", () => {
      let reconciled = 0;
      for (const a of activeSessions(projectRoot)) {
        try {
          reconcileAndSync(projectRoot, config, { incarnationId: a.record.id, sessionId: a.record.sessionId, cwd: a.record.cwd });
          reconciled++;
        } catch {
          /* per-session best effort */
        }
      }
      if (reconciled) say(chalk.cyan(`• change sets reconciled - ${reconciled} session(s)`));
    });

    // 4. Refresh the map.
    step("map refresh", () => {
      const files = scanProject(projectRoot, config);
      say(chalk.cyan(`• map refreshed - ${files} files`));
    });

    // 5. Process the recall queue incrementally. The optional embedder being
    // unavailable is a normal condition (optional dependency), not a failure.
    if (config.recall.enabled) {
      try {
        const n = await refreshFromQueue(projectRoot, config, new LocalEmbedder(config.recall.embedModel));
        if (n) say(chalk.cyan(`• recall queue processed - ${n} chunks`));
      } catch (err) {
        say(chalk.yellow(`• recall skipped - ${(err as Error).message.split("\n")[0]}`));
      }
    }

    // 6. Archive the journal if needed.
    step("journal archive", () => {
      const archived = consolidateJournal(projectRoot);
      if (archived) say(chalk.cyan(`• journal archived - ${archived} old lines`));
    });

    // 7. Delete ONLY genuinely finalized sessions per retention (active and
    // suspended sessions are never removed by age).
    step("session retention", () => {
      const removed = pruneStaleSessions(projectRoot, STALE_SESSION_MS);
      if (removed) say(chalk.cyan(`• finalized sessions pruned - ${removed} removed`));
    });

    // 8. Prune backups - only when everything important above succeeded.
    if (failures.length === 0) {
      step("backup prune", () => {
        const pruned = pruneSnapshots(projectRoot, keep);
        if (pruned) say(chalk.cyan(`• backups pruned - ${pruned} removed (kept ${keep})`));
      });
    } else {
      console.error(chalk.yellow(`! backups NOT pruned - ${failures.length} earlier step(s) failed`));
    }

    if (failures.length) {
      console.error(chalk.red(`✗ maintenance partially failed: ${failures.join(", ")}`));
      return 2;
    }
    say(chalk.green("✓ maintenance complete"));
    return 0;
  } finally {
    // 9. Release the lock - always.
    lock.release();
  }
}
