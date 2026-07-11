import type { Snapshot, NetChange } from "./types.js";

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
