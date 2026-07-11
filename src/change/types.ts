/**
 * Live Change Intelligence types. `ChangeSetV1` is the portable, per-session net
 * change set surfaced to CLI/MCP/dashboard. Internal reconciliation works over
 * `Snapshot`s (a fingerprint map plus git-confirmed renames) and emits
 * `NetChange`s; the store folds those into the persisted `ChangeSetV1`.
 */

export type ChangeKind = "add" | "modify" | "delete" | "rename";
export type ChangeSource = "post-tool" | "file-changed" | "reconcile";
export type MapState = "pending" | "current" | "removed" | "ignored" | "failed";
export type RecallState = "pending" | "queued" | "removed" | "disabled" | "ignored" | "failed";
export type ChangeSetStatus = "active" | "suspended" | "finalized" | "degraded";

export interface ChangeRecordV1 {
  /** Project-relative POSIX path. */
  path: string;
  kind: ChangeKind;
  /** Rename only: the path it moved from. */
  previousPath?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sources: ChangeSource[];
  /** Correlation only (e.g. "Bash"), never a proven attribution. */
  suspectedTools?: string[];
  map: MapState;
  recall: RecallState;
  /** Bounded, sanitized diagnostic. */
  error?: string;
}

export interface CheckResultV1 {
  id: string;
  status: "satisfied" | "missing" | "not-applicable";
  message: string;
}

export interface ChangeSetV1 {
  version: 1;
  incarnationId: string;
  sessionId?: string;
  /** Project root (relative-safe display; not an absolute leak in portable form). */
  root: string;
  cwd?: string;
  status: ChangeSetStatus;
  baselineCreatedAt: string;
  lastReconciledAt?: string;
  reconcileRequested: boolean;
  degradedReason?: string;
  changes: Record<string, ChangeRecordV1>;
  checks: CheckResultV1[];
}

/**
 * A point-in-time fingerprint of the eligible files. `hashes` maps a
 * project-relative POSIX path to a content fingerprint. `renames` carries only
 * git-confirmed moves observed this session (from -> to).
 */
export interface Snapshot {
  hashes: Record<string, string>;
  renames?: Array<{ from: string; to: string }>;
}

/** A single net difference between a baseline snapshot and a current snapshot. */
export interface NetChange {
  path: string;
  kind: ChangeKind;
  previousPath?: string;
}
