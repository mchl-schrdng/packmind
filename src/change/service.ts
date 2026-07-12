import * as fs from "node:fs";
import * as path from "node:path";
import { readTextOr } from "../util/fs-atomic.js";
import { activeSessions } from "../state/session.js";
import { upsertMapEntry, removeMapEntry } from "../state/map-mutations.js";
import { enqueue } from "../recall/queue.js";
import { createBaseline, readBaseline, writeBaseline, reconcileSession } from "./baseline.js";
import { isEligiblePath } from "./eligible.js";
import {
  readChangeSet,
  updateChangeSet,
  emptyChangeSet,
  reconcileInto,
  recallPathsForChange,
} from "./store.js";
import type { ChangeSetV1 } from "./types.js";
import type { Config } from "../state/schema.js";

export interface ResolvedSession {
  incarnationId: string;
  sessionId?: string;
  cwd?: string;
}

/**
 * Resolve which live session a change command targets: an explicit id, else the
 * only active session, else an ambiguity error, else none. Same rule as
 * record_evidence, so CLI/MCP behave consistently.
 */
export function resolveChangeSession(
  root: string,
  sessionId?: string,
): { ok: ResolvedSession } | { error: string } | { none: true } {
  const active = activeSessions(root);
  if (sessionId) {
    const m = active.find((s) => s.record.id === sessionId || s.record.sessionId === sessionId);
    if (!m) return { error: `No active session matching "${sessionId}".` };
    return { ok: { incarnationId: m.record.id, sessionId: m.record.sessionId, cwd: m.record.cwd } };
  }
  if (active.length === 1) {
    const r = active[0].record;
    return { ok: { incarnationId: r.id, sessionId: r.sessionId, cwd: r.cwd } };
  }
  if (active.length === 0) return { none: true };
  return { error: `Multiple active sessions (${active.map((s) => s.record.id).join(", ")}). Pass --session to choose one.` };
}

/**
 * Force a full canonical reconcile (git status or non-git manifest), fold the
 * net set into the change set, and synchronize map + recall. Creates a baseline
 * if one is missing (marking the set degraded). Returns the synced change set.
 */
export function reconcileAndSync(root: string, config: Config, s: ResolvedSession): ChangeSetV1 {
  let baseline = readBaseline(root, s.incarnationId);
  let degradedReason: string | undefined;
  if (!baseline) {
    baseline = createBaseline(root, config, { incarnationId: s.incarnationId, sessionId: s.sessionId, cwd: s.cwd });
    writeBaseline(root, baseline);
    degradedReason = "baseline was missing and rebuilt from the current state";
  }

  // Capture the paths tracked BEFORE this reconcile, so paths that leave the net
  // (reverted to baseline) get their map/recall repaired to the current fs state.
  const before = readChangeSet(root, s.incarnationId);
  const oldPaths = before ? Object.keys(before.changes) : [];

  const net = reconcileSession(root, config, baseline);
  const at = new Date().toISOString();
  const fallback = emptyChangeSet({
    incarnationId: s.incarnationId,
    sessionId: s.sessionId,
    root,
    cwd: s.cwd,
    baselineCreatedAt: baseline.createdAt,
    degradedReason,
  });

  updateChangeSet(root, s.incarnationId, fallback, (cs) => {
    if (degradedReason && cs.status === "active") {
      cs.status = "degraded";
      cs.degradedReason = degradedReason;
    }
    reconcileInto(cs, net, at);
  });

  // Apply map + recall outside the change-set lock (each takes its own file lock).
  const states: Record<string, { map: string; recall: string }> = {};
  for (const n of net) {
    let map = "pending";
    try {
      if (n.kind === "delete") {
        removeMapEntry(root, n.path);
        map = "removed";
      } else {
        if (n.kind === "rename" && n.previousPath) removeMapEntry(root, n.previousPath);
        const abs = path.join(root, n.path);
        if (fs.existsSync(abs)) {
          upsertMapEntry(root, n.path, readTextOr(abs, ""), config); // map even empty files
          map = "current";
        }
      }
    } catch {
      map = "failed";
    }
    let recall = "pending";
    if (!config.recall.enabled) {
      recall = "disabled";
    } else {
      try {
        for (const p of recallPathsForChange(n)) enqueue(root, p);
        recall = n.kind === "delete" ? "removed" : "queued";
      } catch {
        recall = "failed";
      }
    }
    states[n.path] = { map, recall };
  }

  // Repair paths that LEFT the net (reverted to baseline): sync map/recall to the
  // current filesystem state. These are no longer in the change set, so only the
  // side effects matter (a stale map entry from an add-then-delete, or a removed
  // entry from a delete-then-restore).
  const netPaths = new Set(net.map((n) => n.path));
  for (const p of oldPaths) {
    if (netPaths.has(p)) continue;
    const abs = path.join(root, p);
    try {
      // Only read a departed path if it still exists AND is eligible - an
      // ineligible path (secret/binary/etc.) is removed from the map without
      // ever reading its content.
      if (fs.existsSync(abs) && isEligiblePath(root, p, config)) {
        upsertMapEntry(root, p, readTextOr(abs, ""), config);
      } else {
        removeMapEntry(root, p);
      }
    } catch {
      /* best effort */
    }
    if (config.recall.enabled) {
      try {
        enqueue(root, p);
      } catch {
        /* best effort */
      }
    }
  }

  updateChangeSet(root, s.incarnationId, fallback, (cs) => {
    for (const [p, st] of Object.entries(states)) {
      if (cs.changes[p]) {
        cs.changes[p].map = st.map as ChangeSetV1["changes"][string]["map"];
        cs.changes[p].recall = st.recall as ChangeSetV1["changes"][string]["recall"];
      }
    }
  });

  return readChangeSet(root, s.incarnationId) ?? fallback;
}

export function getChangeSet(root: string, incarnationId: string): ChangeSetV1 | null {
  return readChangeSet(root, incarnationId);
}

const SYMBOL: Record<string, string> = { add: "+", modify: "~", delete: "-", rename: "→" };

/** Human-readable one-line-per-change summary for the CLI. */
export function formatChangeSet(cs: ChangeSetV1 | null): string {
  if (!cs || Object.keys(cs.changes).length === 0) return "PackMind changes - no net changes this session.";
  const rows = Object.values(cs.changes)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((c) =>
      c.kind === "rename"
        ? `  ${SYMBOL.rename} ${c.previousPath} -> ${c.path}`
        : `  ${SYMBOL[c.kind] ?? "?"} ${c.path}`,
    );
  const pending = Object.values(cs.changes).filter((c) => c.recall === "pending" || c.recall === "queued").length;
  const lines = [
    `PackMind changes - ${rows.length} file${rows.length === 1 ? "" : "s"}`,
    ...rows,
    "",
    `Memory: map synced - recall ${pending} pending`,
  ];
  if (cs.status === "degraded") lines.push(`Warning: ${cs.degradedReason ?? "tracking degraded"}`);
  if (cs.lastReconciledAt) lines.push(`Last reconciled: ${cs.lastReconciledAt}`);
  return lines.join("\n");
}
