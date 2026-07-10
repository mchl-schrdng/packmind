import { stateFile } from "../util/paths.js";
import { readJsonOr, writeJson } from "../util/fs-atomic.js";

/** Resolve the standard brain-file paths for a project. */
export function brain(projectRoot: string) {
  return {
    dir: stateFile(projectRoot),
    protocol: stateFile(projectRoot, "PACKMIND.md"),
    config: stateFile(projectRoot, "config.json"),
    map: stateFile(projectRoot, "map.md"),
    knowledge: stateFile(projectRoot, "knowledge.md"),
    journal: stateFile(projectRoot, "journal.md"),
    solutions: stateFile(projectRoot, "solutions.json"),
    usage: stateFile(projectRoot, "usage.json"),
    handoff: stateFile(projectRoot, "handoff.md"),
    policy: stateFile(projectRoot, "policy.json"),
    effective: stateFile(projectRoot, "guard.effective.json"),
    identity: stateFile(projectRoot, "identity.md"),
    session: stateFile(projectRoot, "state", "session.json"),
    recallDir: stateFile(projectRoot, "recall"),
    queue: stateFile(projectRoot, "recall", "queue.json"),
    vectors: stateFile(projectRoot, "recall", "vectors.json"),
    compressDir: stateFile(projectRoot, "compress"),
    compressIndex: stateFile(projectRoot, "compress", "index.json"),
    hooksDir: stateFile(projectRoot, "hooks"),
  };
}

/** Per-read accounting record kept during a live session. */
export interface ReadRecord {
  count: number;
  tokens: number;
  cost: number;
  mtime: number;
  first: string;
}

export interface SessionState {
  /** Logical/incarnation id: the ledger row key (a generated uuid). */
  id: string;
  started: string;
  /** Raw Claude session_id this record belongs to (or "" if keyed by transcript). */
  sessionId?: string;
  /** transcript_path fallback key, kept for debuggability. */
  transcriptPath?: string;
  /** Live status: active until a SessionEnd suspends or closes it. */
  status?: "active" | "suspended";
  /** Timestamp of the most recent hook event for this session. */
  lastEventAt?: string;
  /** First and most-recent SessionStart source (startup|resume|clear|compact). */
  initialSource?: string;
  lastSource?: string;
  /** Model reported by SessionStart (when present); used for pricing. */
  model?: string;
  /** Working directory / worktree (project identity is implicit in the file path). */
  cwd?: string;
  reads: Record<string, ReadRecord>;
  writes: Array<{ file: string; action: string; tokens: number; at: string }>;
  editCounts: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  mapHits: number;
  mapMisses: number;
  dedupedReads: number;
  /** Practice-check latches so each session-level check fires at most once/session. */
  notifiedPractice?: string[];
  /** Evidence the agent recorded (via record_evidence) to satisfy practice checks. */
  evidence?: Array<{ check: string; detail?: string; at: string }>;
}

export function emptySession(id: string): SessionState {
  return {
    id,
    started: new Date().toISOString(),
    reads: {},
    writes: [],
    editCounts: {},
    inputTokens: 0,
    outputTokens: 0,
    inputCost: 0,
    outputCost: 0,
    mapHits: 0,
    mapMisses: 0,
    dedupedReads: 0,
  };
}

export function readSession(projectRoot: string): SessionState | null {
  return readJsonOr<SessionState | null>(brain(projectRoot).session, null);
}

export function writeSession(projectRoot: string, s: SessionState): void {
  writeJson(brain(projectRoot).session, s);
}
