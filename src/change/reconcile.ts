import type { Snapshot, NetChange, ChangeKind } from "./types.js";
import type { PorcelainStatus } from "./git.js";

/**
 * Net differences between a baseline snapshot (session start) and the current
 * snapshot. Comparing endpoints - not folding an event log - is what makes the
 * net semantics fall out: add-then-delete vanishes (absent at both), a file
 * restored to its baseline fingerprint vanishes, and a pre-existing dirty file
 * that hasn't changed since baseline is not a session change.
 *
 * Git-confirmed renames (from -> to) are preserved when `from` was in the
 * baseline and `to` exists now; otherwise the pair degrades to plain add/delete
 * based on presence at each endpoint (the spec's "uncertain rename" rule).
 */
export function computeNetChanges(baseline: Snapshot, current: Snapshot): NetChange[] {
  const out: NetChange[] = [];
  const handled = new Set<string>();

  for (const { from, to } of current.renames ?? []) {
    const fromInBaseline = baseline.hashes[from] !== undefined;
    const toNow = current.hashes[to] !== undefined;
    if (fromInBaseline && toNow) {
      out.push({ path: to, kind: "rename", previousPath: from });
      handled.add(from);
      handled.add(to);
    }
    // Uncertain: leave `from`/`to` for the presence-based passes below, which
    // will classify them as delete/add as appropriate.
  }

  for (const [rel, hash] of Object.entries(current.hashes)) {
    if (handled.has(rel)) continue;
    const base = baseline.hashes[rel];
    if (base === undefined) out.push({ path: rel, kind: "add" });
    else if (base !== hash) out.push({ path: rel, kind: "modify" });
  }

  for (const rel of Object.keys(baseline.hashes)) {
    if (handled.has(rel)) continue;
    if (current.hashes[rel] === undefined) out.push({ path: rel, kind: "delete" });
  }

  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Baseline for git projects: the porcelain status at session start plus content
 * fingerprints for the paths that were already dirty/untracked then. */
export interface GitBaseline {
  status: PorcelainStatus;
  hashes: Record<string, string>;
}
/** Current git state: porcelain status now plus fingerprints for the overlap
 * paths (dirty at baseline AND still relevant), so further changes are detected. */
export interface GitCurrent {
  status: PorcelainStatus;
  hashes: Record<string, string>;
}

function kindFromXy(xy: string): ChangeKind {
  if (xy.includes("D")) return "delete";
  if (xy === "??" || xy.includes("A")) return "add";
  return "modify";
}

/**
 * Net session changes for a git project, computed from porcelain status diffed
 * against the SESSION BASELINE (not HEAD). A path already dirty at baseline is
 * only a session change if it changed further (its fingerprint moved, or it
 * disappeared); otherwise pre-existing dirt is not attributed to the session.
 * Only renames new since baseline are reported as renames.
 */
export function reconcileGit(baseline: GitBaseline, current: GitCurrent): NetChange[] {
  const out: NetChange[] = [];
  const handled = new Set<string>();

  const baselinePaths = new Set<string>();
  for (const e of baseline.status.changed) baselinePaths.add(e.path);
  for (const r of baseline.status.renames) {
    baselinePaths.add(r.from);
    baselinePaths.add(r.to);
  }
  const baselineRenames = new Set(baseline.status.renames.map((r) => `${r.from}\0${r.to}`));

  for (const { from, to } of current.status.renames) {
    if (baselineRenames.has(`${from}\0${to}`)) {
      handled.add(from);
      handled.add(to);
      continue; // pre-existing rename, not a session change
    }
    out.push({ path: to, kind: "rename", previousPath: from });
    handled.add(from);
    handled.add(to);
  }

  for (const { path: rel, xy } of current.status.changed) {
    if (handled.has(rel)) continue;
    const wasDirty = baselinePaths.has(rel) || baseline.hashes[rel] !== undefined;
    if (!wasDirty) {
      out.push({ path: rel, kind: kindFromXy(xy) });
      continue;
    }
    // Dirty at baseline: only a further change counts. Compare fingerprints.
    const baseHash = baseline.hashes[rel];
    const curHash = current.hashes[rel];
    if (baseHash !== undefined && curHash === undefined) {
      out.push({ path: rel, kind: "delete" });
    } else if (baseHash !== undefined && curHash !== undefined && baseHash !== curHash) {
      out.push({ path: rel, kind: "modify" });
    }
    // else: cannot prove a further change; treat as pre-existing dirt (skip).
  }

  return out.sort((a, b) => a.path.localeCompare(b.path));
}
