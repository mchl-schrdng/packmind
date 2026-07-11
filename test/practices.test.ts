import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { resolvePractices, writeEffective, listPacks, type Pack } from "../src/guard/practices.js";
import { brain } from "../src/state/files.js";
import { updateSession, readSessionRecord } from "../src/state/session.js";
import { DEFAULT_CONFIG, type Config } from "../src/state/schema.js";
import { computePracticeReminders, newSession, type SessionCheck } from "../src/hooks/runtime.js";
import { toolRecordEvidence, type ToolContext } from "../src/mcp/tools.js";

function cfg(practices: string[]): Config {
  return { ...DEFAULT_CONFIG, guard: { ...DEFAULT_CONFIG.guard, practices } };
}

describe("practice packs", () => {
  let root: string;
  let packsDir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-practice-"));
    fs.mkdirSync(brain(root).dir, { recursive: true });
    packsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-packs-"));
    const quality: Pack = {
      name: "quality-core",
      version: 1,
      rules: [{ id: "no-console", message: "no console.log", severity: "warn", pathGlob: "src/**", content: "console\\.log" }],
      checks: [{
        id: "src-without-tests", message: "add a test",
        changedGlobs: ["src/**"], missingChangedGlobs: ["test/**"], needsEvidence: "tests-updated",
      }],
    };
    fs.writeFileSync(path.join(packsDir, "quality-core.json"), JSON.stringify(quality));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(packsDir, { recursive: true, force: true });
  });

  it("resolvePractices composes default rules + pack + local policy (local last)", () => {
    fs.writeFileSync(brain(root).policy, JSON.stringify({ rules: [{ id: "local", message: "m", severity: "warn", pathGlob: "x/**" }] }));
    const { rules, checks } = resolvePractices(root, cfg(["quality-core"]), packsDir);
    const ids = rules.map((r) => r.id);
    expect(ids).toContain("no-secret-files"); // DEFAULT_POLICY
    expect(ids).toContain("no-console"); // pack
    expect(ids[ids.length - 1]).toBe("local"); // local override appended last
    expect(checks.map((c) => c.id)).toEqual(["src-without-tests"]);
  });

  it("resolvePractices ignores unknown pack names safely", () => {
    const { checks } = resolvePractices(root, cfg(["quality-core", "does-not-exist"]), packsDir);
    expect(checks.map((c) => c.id)).toEqual(["src-without-tests"]);
  });

  it("writeEffective writes the derived guard file the hooks read", () => {
    writeEffective(root, cfg(["quality-core"]), packsDir);
    const eff = JSON.parse(fs.readFileSync(brain(root).effective, "utf8"));
    expect(eff.rules.some((r: { id: string }) => r.id === "no-console")).toBe(true);
    expect(eff.checks[0].id).toBe("src-without-tests");
  });

  it("computePracticeReminders fires on a matching write and latches once", () => {
    const checks: SessionCheck[] = [{ id: "c1", message: "add a test", changedGlobs: ["src/**"], missingChangedGlobs: ["test/**"] }];
    const s = newSession("s");
    s.writes = [{ file: "src/foo.ts", action: "Write", tokens: 1, at: "t" }];
    expect(computePracticeReminders(s, checks)).toEqual(["add a test"]);
    expect(s.notifiedPractice).toContain("c1");
    expect(computePracticeReminders(s, checks)).toEqual([]); // latched
  });

  it("does not fire when a missingChangedGlobs file was also written", () => {
    const checks: SessionCheck[] = [{ id: "c1", message: "add a test", changedGlobs: ["src/**"], missingChangedGlobs: ["test/**"] }];
    const s = newSession("s");
    s.writes = [
      { file: "src/foo.ts", action: "Write", tokens: 1, at: "t" },
      { file: "test/foo.test.ts", action: "Write", tokens: 1, at: "t" },
    ];
    expect(computePracticeReminders(s, checks)).toEqual([]);
  });

  it("evidence suppresses a check without latching it", () => {
    const checks: SessionCheck[] = [{ id: "c1", message: "add a test", changedGlobs: ["src/**"], needsEvidence: "tests-updated" }];
    const s = newSession("s");
    s.writes = [{ file: "src/foo.ts", action: "Write", tokens: 1, at: "t" }];
    s.evidence = [{ check: "tests-updated", at: "t" }];
    expect(computePracticeReminders(s, checks)).toEqual([]); // suppressed by evidence
    expect(s.notifiedPractice).not.toContain("c1"); // NOT latched
    // Remove the evidence and it fires again (evidence, not a latch, keeps it quiet).
    s.evidence = [];
    expect(computePracticeReminders(s, checks)).toEqual(["add a test"]);
  });

  it("record_evidence attaches evidence to the single active session and quiets the check", () => {
    // A live session that touched src/** but wrote no test.
    updateSession(root, "raw1", (s) => {
      s.status = "active";
      s.sessionId = "s1";
      s.writes = [{ file: "src/foo.ts", action: "Write", tokens: 1, at: "t" }];
    });

    const ctx = { projectRoot: root } as ToolContext;
    const msg = toolRecordEvidence(ctx, { check: "tests-updated", detail: "doc-only" });
    expect(msg).toContain("tests-updated");

    const after = readSessionRecord(root, "raw1")!;
    expect(after.evidence?.[0].check).toBe("tests-updated");

    const checks: SessionCheck[] = [{ id: "c1", message: "add a test", changedGlobs: ["src/**"], needsEvidence: "tests-updated" }];
    expect(computePracticeReminders(after as any, checks)).toEqual([]);
  });

  it("record_evidence errors on multiple active sessions unless a session_id is given", () => {
    updateSession(root, "rawA", (s) => { s.status = "active"; });
    updateSession(root, "rawB", (s) => { s.status = "active"; });
    const ctx = { projectRoot: root } as ToolContext;

    // Ambiguous: two live sessions, no id -> refuse and list them.
    expect(toolRecordEvidence(ctx, { check: "tests-updated" })).toContain("Multiple active sessions");

    // Routed by the incarnation id shown at SessionStart.
    const idA = readSessionRecord(root, "rawA")!.id;
    expect(toolRecordEvidence(ctx, { check: "tests-updated", session_id: idA })).toContain(idA);
    expect(readSessionRecord(root, "rawA")!.evidence?.[0].check).toBe("tests-updated");
    expect(readSessionRecord(root, "rawB")!.evidence ?? []).toHaveLength(0);
  });

  it("record_evidence with no active session records nothing", () => {
    const ctx = { projectRoot: root } as ToolContext;
    expect(toolRecordEvidence(ctx, { check: "tests-updated" })).toContain("No active session");
  });

  it("the shipped packs are all valid JSON with a name", () => {
    for (const name of listPacks()) {
      const { rules, checks } = resolvePractices(root, cfg([name]));
      expect(Array.isArray(rules)).toBe(true);
      expect(Array.isArray(checks)).toBe(true);
    }
  });
});
