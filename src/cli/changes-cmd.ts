import { requireProject } from "./ctx.js";
import { resolveChangeSession, reconcileAndSync, getChangeSet, formatChangeSet } from "../change/service.js";

/** `packmind changes` - show the current session's net change set. */
export function runChanges(opts: { session?: string; json?: boolean } = {}): void {
  const { projectRoot } = requireProject();
  const r = resolveChangeSession(projectRoot, opts.session);
  if ("error" in r) {
    console.error(r.error);
    process.exit(1);
  }
  if ("none" in r) {
    console.log(opts.json ? "null" : "No active PackMind session.");
    return;
  }
  const cs = getChangeSet(projectRoot, r.ok.incarnationId);
  console.log(opts.json ? JSON.stringify(cs, null, 2) : formatChangeSet(cs));
}

/** `packmind reconcile` - force a full reconcile and sync map/recall. */
export function runReconcile(opts: { session?: string; json?: boolean } = {}): void {
  const { projectRoot, config } = requireProject();
  const r = resolveChangeSession(projectRoot, opts.session);
  if ("error" in r) {
    console.error(r.error);
    process.exit(1);
  }
  if ("none" in r) {
    console.log(opts.json ? "null" : "No active PackMind session to reconcile.");
    return;
  }
  const cs = reconcileAndSync(projectRoot, config, r.ok);
  console.log(opts.json ? JSON.stringify(cs, null, 2) : formatChangeSet(cs));
}
