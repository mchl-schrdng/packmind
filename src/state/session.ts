import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { brain, emptySession, type SessionState } from "./files.js";
import { readJsonOr, updateJson } from "../util/fs-atomic.js";

/**
 * Per-session lifecycle. State is keyed by a HASH of the raw Claude session key
 * (session_id, or transcript_path as a fallback), one file per real session, so
 * concurrent Claude instances never collide. The ledger row key is a generated
 * `incarnationId` (this record's `id`), independent of the raw session_id -
 * which the docs do not guarantee is stable across /clear. Mirrored (pure parts)
 * in hooks/runtime.ts and pinned by runtime-parity.test.ts.
 */

/** SessionEnd reasons that remove the live file (the incarnation is finished). */
const REMOVE_REASONS = new Set([
  "clear",
  "logout",
  "prompt_input_exit",
  "bypass_permissions_disabled",
  "other",
]);

export interface SessionStartInput {
  source: string;
  now: string;
  newIncarnationId: string;
  sessionId: string;
  transcriptPath?: string;
  model?: string;
  cwd?: string;
}

export interface SessionEndInput {
  reason: string;
  now: string;
}

/** The raw key that identifies a session: session_id, else transcript_path, else null. */
export function sessionRawKey(input: Record<string, unknown>): string | null {
  const sid = input?.session_id;
  if (typeof sid === "string" && sid.trim()) return sid;
  const tp = input?.transcript_path;
  if (typeof tp === "string" && tp.trim()) return tp;
  return null;
}

/** Per-session file, named by a hash of the raw key (injective, path-safe). */
export function sessionFile(root: string, rawKey: string): string {
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 16);
  return path.join(brain(root).dir, "state", "sessions", `${hash}.json`);
}

/** A brand-new active incarnation with fresh counters. */
export function freshRecord(input: SessionStartInput): SessionState {
  const s = emptySession(input.newIncarnationId);
  s.started = input.now;
  s.sessionId = input.sessionId;
  if (input.transcriptPath) s.transcriptPath = input.transcriptPath;
  s.status = "active";
  s.lastEventAt = input.now;
  s.initialSource = input.source;
  s.lastSource = input.source;
  if (input.model) s.model = input.model;
  if (input.cwd) s.cwd = input.cwd;
  return s;
}

/**
 * Pure SessionStart decision. `startup`/`resume`/`compact` reattach an existing
 * record (reactivate, keep counters); `/clear` folds the old incarnation into
 * the ledger and mints a brand-new one. No existing record -> a fresh incarnation.
 */
export function applySessionStart(
  existing: SessionState | null,
  input: SessionStartInput,
): { record: SessionState; fold: SessionState | null } {
  if (input.source === "clear" && existing) {
    return { record: freshRecord(input), fold: existing };
  }
  if (existing) {
    return {
      record: {
        ...existing,
        status: "active",
        lastEventAt: input.now,
        lastSource: input.source,
        model: input.model ?? existing.model,
      },
      fold: null,
    };
  }
  return { record: freshRecord(input), fold: null };
}

/** `resume` and unknown/missing reasons suspend (keep the file); the rest remove it. */
export function classifySessionEnd(reason: string): "remove" | "suspend" {
  return REMOVE_REASONS.has(reason) ? "remove" : "suspend";
}

/**
 * Pure SessionEnd decision. Always folds (idempotent). A terminal/clear reason
 * removes the live file; resume/unknown suspends and keeps it (never delete a
 * session that may be resuming).
 */
export function applySessionEnd(
  existing: SessionState,
  input: SessionEndInput,
): { fold: SessionState; remove: boolean; record: SessionState | null } {
  if (classifySessionEnd(input.reason) === "remove") {
    return { fold: existing, remove: true, record: null };
  }
  return {
    fold: existing,
    remove: false,
    record: { ...existing, status: "suspended", lastEventAt: input.now },
  };
}

export function readSessionRecord(root: string, rawKey: string): SessionState | null {
  return readJsonOr<SessionState | null>(sessionFile(root, rawKey), null);
}

/**
 * Currently-active sessions (status active), each with its on-disk file path.
 * Used to route MCP mutations (record_evidence) to the right live session and to
 * report the active count on the dashboard.
 */
export function activeSessions(root: string): Array<{ file: string; record: SessionState }> {
  const dir = path.join(brain(root).dir, "state", "sessions");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Array<{ file: string; record: SessionState }> = [];
  for (const n of names) {
    const file = path.join(dir, n);
    const record = readJsonOr<SessionState | null>(file, null);
    if (record && record.status === "active") out.push({ file, record });
  }
  return out;
}

/**
 * Prune stale session files: only records that are neither active NOR
 * suspended (i.e. genuinely finalized leftovers) older than `maxAgeMs` by
 * lastEventAt. Active sessions are live; suspended ones may resume at any
 * time (possibly after a rate limit) - age alone never deletes either.
 * Returns how many were removed.
 */
export function pruneStaleSessions(root: string, maxAgeMs: number): number {
  const dir = path.join(brain(root).dir, "state", "sessions");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return 0;
  }
  const now = Date.now();
  let removed = 0;
  for (const n of names) {
    const file = path.join(dir, n);
    const rec = readJsonOr<SessionState | null>(file, null);
    if (!rec || rec.status === "active" || rec.status === "suspended") continue;
    const last = rec.lastEventAt ? Date.parse(rec.lastEventAt) : 0;
    if (now - (Number.isFinite(last) ? last : 0) > maxAgeMs) {
      try {
        fs.rmSync(file, { force: true });
        removed++;
      } catch {
        /* best effort */
      }
    }
  }
  return removed;
}

/** Locked read-modify-write for one session's file (no lost updates). */
export function updateSession(root: string, rawKey: string, fn: (s: SessionState) => void): void {
  updateJson<SessionState | null>(sessionFile(root, rawKey), null, (prev) => {
    const s = prev ?? emptySession(rawKey);
    fn(s);
    return s;
  });
}
