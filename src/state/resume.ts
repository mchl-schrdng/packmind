import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { stateFile } from "../util/paths.js";
import { readJsonOr, updateJson } from "../util/fs-atomic.js";

/**
 * Local resume tickets: one small JSON file per rate-limited Claude session,
 * written by the StopFailure hook and consumed by `packmind resume`. Tickets
 * hold ONLY lifecycle metadata (never API messages, secrets, source content,
 * or transcripts). The file name is a hash of the raw session_id, mirroring
 * the session-file naming (injective, path-safe).
 */
export interface ResumeTicketV1 {
  version: 1;
  sessionId: string;
  status: "blocked" | "launching" | "resumed";
  createdAt: string;
  updatedAt: string;
  resetAt?: string;
  reconcileRequested: boolean;
}

export function ticketsDir(root: string): string {
  return stateFile(root, "state", "resume-tickets");
}

export function ticketFile(root: string, sessionId: string): string {
  const hash = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  return path.join(ticketsDir(root), `${hash}.json`);
}

export function readTicket(root: string, sessionId: string): ResumeTicketV1 | null {
  return readJsonOr<ResumeTicketV1 | null>(ticketFile(root, sessionId), null);
}

export function listTickets(root: string): Array<{ file: string; ticket: ResumeTicketV1 }> {
  let names: string[];
  try {
    names = fs.readdirSync(ticketsDir(root)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Array<{ file: string; ticket: ResumeTicketV1 }> = [];
  for (const n of names) {
    const file = path.join(ticketsDir(root), n);
    const t = readJsonOr<ResumeTicketV1 | null>(file, null);
    if (t && t.version === 1 && typeof t.sessionId === "string") out.push({ file, ticket: t });
  }
  return out;
}

/** Create-or-reset a ticket to blocked. A resetAt is only ever recorded when
 * the caller clearly extracted one; a prior known resetAt survives a re-block. */
export function blockTicket(root: string, sessionId: string, now: string, resetAt?: string): void {
  updateJson<ResumeTicketV1 | null>(ticketFile(root, sessionId), null, (prev) => {
    const kept = resetAt ?? prev?.resetAt;
    return {
      version: 1,
      sessionId,
      status: "blocked",
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      ...(kept ? { resetAt: kept } : {}),
      reconcileRequested: true,
    };
  });
}

/** Atomic blocked -> launching transition (read+write under one file lock).
 * Returns false when the ticket is absent or not blocked, so a second
 * concurrent `packmind resume` is refused instead of double-launching. */
export function tryAcquireLaunch(root: string, sessionId: string, now: string): boolean {
  let acquired = false;
  updateJson<ResumeTicketV1 | null>(ticketFile(root, sessionId), null, (t) => {
    if (t && t.status === "blocked") {
      acquired = true;
      return { ...t, status: "launching", updatedAt: now };
    }
    return t;
  });
  if (!acquired) {
    // updateJson may have materialized a null file for a missing ticket; drop it.
    const t = readJsonOr<ResumeTicketV1 | null>(ticketFile(root, sessionId), null);
    if (!t) removeTicket(root, sessionId);
  }
  return acquired;
}

/** Roll a failed/unconfirmed launch back to blocked so the ticket stays
 * recoverable. A ticket already removed (SessionStart confirmed the resume)
 * is left absent - never re-materialized. */
export function releaseLaunch(root: string, sessionId: string, now: string): void {
  const file = ticketFile(root, sessionId);
  if (!fs.existsSync(file)) return;
  updateJson<ResumeTicketV1 | null>(file, null, (t) =>
    t ? { ...t, status: "blocked", updatedAt: now } : t,
  );
  // The existence check above can race with a concurrent removal, leaving a
  // literal `null` JSON file behind; drop it (same guard as tryAcquireLaunch).
  if (!readJsonOr<ResumeTicketV1 | null>(file, null)) removeTicket(root, sessionId);
}

export function removeTicket(root: string, sessionId: string): void {
  try {
    fs.rmSync(ticketFile(root, sessionId), { force: true });
  } catch {
    /* best effort */
  }
}
