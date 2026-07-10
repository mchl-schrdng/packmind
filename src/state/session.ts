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

/** Locked read-modify-write for one session's file (no lost updates). */
export function updateSession(root: string, rawKey: string, fn: (s: SessionState) => void): void {
  updateJson<SessionState | null>(sessionFile(root, rawKey), null, (prev) => {
    const s = prev ?? emptySession(rawKey);
    fn(s);
    return s;
  });
}
