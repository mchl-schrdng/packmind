import * as path from "node:path";
import { brain } from "../state/files.js";
import { readJsonOr, updateJson } from "../util/fs-atomic.js";
import type { ChangeSetV1, NetChange, ChangeSource } from "./types.js";

const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 128) || "unknown";

export function changeSetFile(root: string, incarnationId: string): string {
  return path.join(brain(root).changeSetDir, `${safeId(incarnationId)}.json`);
}

export function emptyChangeSet(meta: {
  incarnationId: string;
  sessionId?: string;
  root: string;
  cwd?: string;
  baselineCreatedAt: string;
  degradedReason?: string;
}): ChangeSetV1 {
  return {
    version: 1,
    incarnationId: meta.incarnationId,
    sessionId: meta.sessionId,
    root: meta.root,
    cwd: meta.cwd,
    status: meta.degradedReason ? "degraded" : "active",
    baselineCreatedAt: meta.baselineCreatedAt,
    reconcileRequested: false,
    degradedReason: meta.degradedReason,
    changes: {},
    checks: [],
  };
}

/** Record an immediate single-path candidate from a direct tool or FileChanged. */
export function recordCandidate(
  cs: ChangeSetV1,
  change: NetChange,
  source: ChangeSource,
  at: string,
  suspectedTools?: string[],
): void {
  const existing = cs.changes[change.path];
  if (existing) {
    existing.kind = change.kind;
    if (change.previousPath) existing.previousPath = change.previousPath;
    existing.lastSeenAt = at;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (suspectedTools?.length) {
      existing.suspectedTools = Array.from(new Set([...(existing.suspectedTools ?? []), ...suspectedTools]));
    }
    existing.map = "pending";
    existing.recall = "pending";
  } else {
    cs.changes[change.path] = {
      path: change.path,
      kind: change.kind,
      previousPath: change.previousPath,
      firstSeenAt: at,
      lastSeenAt: at,
      sources: [source],
      suspectedTools: suspectedTools?.length ? suspectedTools : undefined,
      map: "pending",
      recall: "pending",
    };
  }
}

/**
 * Authoritatively sync the change set to a reconciliation's net result: update
 * present paths (preserving `firstSeenAt`), add new ones, and DROP paths that
 * are no longer in the net set (they reverted to baseline). Marks the reconcile
 * satisfied.
 */
export function reconcileInto(cs: ChangeSetV1, net: NetChange[], at: string): void {
  const present = new Set(net.map((n) => n.path));
  for (const p of Object.keys(cs.changes)) {
    if (!present.has(p)) delete cs.changes[p];
  }
  for (const n of net) {
    const existing = cs.changes[n.path];
    if (existing) {
      const kindChanged = existing.kind !== n.kind || existing.previousPath !== n.previousPath;
      existing.kind = n.kind;
      existing.previousPath = n.previousPath;
      existing.lastSeenAt = at;
      if (!existing.sources.includes("reconcile")) existing.sources.push("reconcile");
      if (kindChanged) {
        existing.map = "pending";
        existing.recall = "pending";
      }
    } else {
      cs.changes[n.path] = {
        path: n.path,
        kind: n.kind,
        previousPath: n.previousPath,
        firstSeenAt: at,
        lastSeenAt: at,
        sources: ["reconcile"],
        map: "pending",
        recall: "pending",
      };
    }
  }
  cs.lastReconciledAt = at;
  cs.reconcileRequested = false;
}

/**
 * Project-relative paths to enqueue for recall given a change. Add/modify/delete
 * enqueue the path itself (the indexer re-embeds if present, drops the source if
 * absent); a rename enqueues both the old and new paths.
 */
export function recallPathsForChange(change: { kind: NetChange["kind"]; path: string; previousPath?: string }): string[] {
  if (change.kind === "rename" && change.previousPath) return [change.previousPath, change.path];
  return [change.path];
}

export function readChangeSet(root: string, incarnationId: string): ChangeSetV1 | null {
  return readJsonOr<ChangeSetV1 | null>(changeSetFile(root, incarnationId), null);
}

/** Locked atomic read-modify-write of a change set (no lost updates). */
export function updateChangeSet(
  root: string,
  incarnationId: string,
  fallback: ChangeSetV1,
  fn: (cs: ChangeSetV1) => void,
): void {
  updateJson<ChangeSetV1>(changeSetFile(root, incarnationId), fallback, (cs) => {
    fn(cs);
    return cs;
  });
}
