import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { scanProject } from "../state/mapper.js";
import { consolidateJournal } from "../state/maintain.js";
import { buildIndex } from "../recall/indexer.js";
import { LocalEmbedder } from "../recall/embedder.js";
import { pruneSnapshots } from "../state/snapshot.js";
import { pruneStaleSessions, activeSessions } from "../state/session.js";
import { reconcileAndSync } from "../change/service.js";

const STALE_SESSION_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * One-shot maintenance: refresh the map, rebuild the recall index, archive an
 * overgrown journal, and prune old backups. Designed to be run from the user's
 * own scheduler (cron/launchd) - no persistent daemon, no ports, no state to
 * leak. `--quiet` suppresses output for unattended runs.
 */
export async function runMaintain(opts: { quiet?: boolean; keepBackups?: string } = {}): Promise<void> {
  const { projectRoot, config } = requireProject();
  const say = (m: string) => {
    if (!opts.quiet) console.log(m);
  };

  // Reconcile every active session's change set (also the authoritative path for
  // non-git projects) so the map/recall reflect all sources, then refresh the map.
  let reconciled = 0;
  for (const a of activeSessions(projectRoot)) {
    try {
      reconcileAndSync(projectRoot, config, { incarnationId: a.record.id, sessionId: a.record.sessionId, cwd: a.record.cwd });
      reconciled++;
    } catch {
      /* best effort */
    }
  }
  if (reconciled) say(chalk.cyan(`• change sets reconciled - ${reconciled} session(s)`));

  const files = scanProject(projectRoot, config);
  say(chalk.cyan(`• map refreshed - ${files} files`));

  if (config.recall.enabled) {
    try {
      const n = await buildIndex(projectRoot, config, new LocalEmbedder(config.recall.embedModel));
      say(chalk.cyan(`• recall reindexed - ${n} chunks`));
    } catch (err) {
      say(chalk.yellow(`• recall skipped - ${(err as Error).message.split("\n")[0]}`));
    }
  }

  const archived = consolidateJournal(projectRoot);
  if (archived) say(chalk.cyan(`• journal archived - ${archived} old lines`));

  const keep = opts.keepBackups ? parseInt(opts.keepBackups, 10) : 10;
  const pruned = pruneSnapshots(projectRoot, keep);
  if (pruned) say(chalk.cyan(`• backups pruned - ${pruned} removed (kept ${keep})`));

  const staleSessions = pruneStaleSessions(projectRoot, STALE_SESSION_MS);
  if (staleSessions) say(chalk.cyan(`• stale sessions pruned - ${staleSessions} removed`));

  say(chalk.green("✓ maintenance complete"));
}
