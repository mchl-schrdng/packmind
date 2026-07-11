import { describe, it, expect } from "vitest";
import {
  sessionRawKey,
  sessionFile,
  freshRecord,
  applySessionStart,
  applySessionEnd,
  classifySessionEnd,
  type SessionStartInput,
} from "../src/state/session.js";

const base: SessionStartInput = {
  source: "startup",
  now: "2026-07-10T00:00:00.000Z",
  newIncarnationId: "inc-1",
  sessionId: "s1",
};

describe("sessionRawKey", () => {
  it("prefers session_id, falls back to transcript_path, else null", () => {
    expect(sessionRawKey({ session_id: "abc" })).toBe("abc");
    expect(sessionRawKey({ transcript_path: "/t.jsonl" })).toBe("/t.jsonl");
    expect(sessionRawKey({ session_id: "  ", transcript_path: "/t.jsonl" })).toBe("/t.jsonl");
    expect(sessionRawKey({})).toBeNull();
  });
});

describe("sessionFile", () => {
  it("is injective for distinct raw keys (hashed, path-safe)", () => {
    const a = sessionFile("/root", "session-A");
    const b = sessionFile("/root", "session-B");
    expect(a).not.toBe(b);
    // Hashed basename: no raw id leakage, no path separators from the key.
    expect(a.endsWith(".json")).toBe(true);
    expect(sessionFile("/root", "../../etc")).toContain("/state/sessions/");
  });
});

describe("applySessionStart", () => {
  it("startup with no existing mints a fresh active incarnation", () => {
    const { record, fold } = applySessionStart(null, base);
    expect(fold).toBeNull();
    expect(record.id).toBe("inc-1");
    expect(record.sessionId).toBe("s1");
    expect(record.status).toBe("active");
    expect(record.initialSource).toBe("startup");
    expect(record.inputTokens).toBe(0);
  });

  it("resume/compact/startup reattach an existing record without resetting", () => {
    const existing = { ...freshRecord({ ...base, newIncarnationId: "inc-0" }), inputTokens: 42, status: "suspended" as const };
    for (const source of ["resume", "compact", "startup"]) {
      const { record, fold } = applySessionStart(existing, { ...base, source, newIncarnationId: "inc-NEW" });
      expect(fold).toBeNull();
      expect(record.id).toBe("inc-0"); // same incarnation, not the new id
      expect(record.inputTokens).toBe(42); // preserved
      expect(record.status).toBe("active"); // reactivated
      expect(record.lastSource).toBe(source);
    }
  });

  it("clear folds the old incarnation and mints a brand new one", () => {
    const existing = { ...freshRecord({ ...base, newIncarnationId: "inc-0" }), inputTokens: 99 };
    const { record, fold } = applySessionStart(existing, { ...base, source: "clear", newIncarnationId: "inc-2" });
    expect(fold).toBe(existing); // old incarnation handed to the ledger
    expect(record.id).toBe("inc-2"); // fresh incarnation id (not rawId#epoch)
    expect(record.inputTokens).toBe(0); // fresh counters
  });

  it("captures model and cwd on a fresh record", () => {
    const { record } = applySessionStart(null, { ...base, model: "claude-sonnet-5", cwd: "/w" });
    expect(record.model).toBe("claude-sonnet-5");
    expect(record.cwd).toBe("/w");
  });
});

describe("classifySessionEnd / applySessionEnd", () => {
  it("resume and unknown suspend (keep file); clear and terminal reasons remove", () => {
    expect(classifySessionEnd("resume")).toBe("suspend");
    expect(classifySessionEnd("")).toBe("suspend"); // unknown/missing is safe
    expect(classifySessionEnd("clear")).toBe("remove");
    for (const r of ["logout", "prompt_input_exit", "bypass_permissions_disabled", "other"]) {
      expect(classifySessionEnd(r)).toBe("remove");
    }
  });

  it("applySessionEnd folds always; suspends-and-keeps or removes per reason", () => {
    const rec = { ...freshRecord({ ...base, newIncarnationId: "inc-0" }), inputTokens: 5 };

    const suspended = applySessionEnd(rec, { reason: "resume", now: "t1" });
    expect(suspended.fold).toBe(rec);
    expect(suspended.remove).toBe(false);
    expect(suspended.record!.status).toBe("suspended");

    const removed = applySessionEnd(rec, { reason: "logout", now: "t1" });
    expect(removed.fold).toBe(rec);
    expect(removed.remove).toBe(true);
    expect(removed.record).toBeNull();
  });
});
