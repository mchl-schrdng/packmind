import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { brain } from "../src/state/files.js";
import { updateSession } from "../src/state/session.js";
import { createBaseline, writeBaseline } from "../src/change/baseline.js";
import { resolveChangeSession, reconcileAndSync, getChangeSet, formatChangeSet } from "../src/change/service.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

const config = DEFAULT_CONFIG;

function gitProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-csvc-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  fs.mkdirSync(path.join(brain(dir).dir, "state", "sessions"), { recursive: true });
  fs.writeFileSync(brain(dir).config, JSON.stringify(config));
  fs.writeFileSync(path.join(dir, "seed.ts"), "seed");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);
  return dir;
}

describe("[P1] change service: routing", () => {
  it("resolves the single active session, errors on ambiguity, and reports none", () => {
    const dir = gitProject();
    expect(resolveChangeSession(dir)).toEqual({ none: true });

    updateSession(dir, "A", (s) => { s.status = "active"; });
    const one = resolveChangeSession(dir);
    expect("ok" in one && one.ok.incarnationId).toBe("A");

    updateSession(dir, "B", (s) => { s.status = "active"; });
    const many = resolveChangeSession(dir);
    expect("error" in many && many.error).toContain("Multiple active sessions");

    const byId = resolveChangeSession(dir, "B");
    expect("ok" in byId && byId.ok.incarnationId).toBe("B");
  });
});

describe("[P1] change service: reconcile + sync", () => {
  it("detects a change made after the baseline and syncs the map", () => {
    const dir = gitProject();
    updateSession(dir, "S1", (s) => { s.status = "active"; s.sessionId = "S1"; });

    // Baseline captured before the change.
    writeBaseline(dir, createBaseline(dir, config, { incarnationId: "S1", sessionId: "S1" }));

    // A change appears (as if from Bash / a generator).
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "gen.ts"), "export const g = 1;\n");

    const cs = reconcileAndSync(dir, config, { incarnationId: "S1", sessionId: "S1" });
    expect(cs.changes["src/gen.ts"].kind).toBe("add");
    expect(cs.changes["src/gen.ts"].map).toBe("current");
    expect(fs.readFileSync(brain(dir).map, "utf8")).toContain("gen.ts");

    // getChangeSet + formatter agree.
    expect(getChangeSet(dir, "S1")!.changes["src/gen.ts"]).toBeTruthy();
    expect(formatChangeSet(cs)).toContain("src/gen.ts");
  });

  it("a reverted add is removed from the map + change set on the next reconcile", () => {
    const dir = gitProject();
    updateSession(dir, "S1", (s) => { s.status = "active"; s.sessionId = "S1"; });
    writeBaseline(dir, createBaseline(dir, config, { incarnationId: "S1", sessionId: "S1" }));

    // Add a file, reconcile -> it's in the change set and the map.
    fs.writeFileSync(path.join(dir, "temp.ts"), "export const t = 1;\n");
    let cs = reconcileAndSync(dir, config, { incarnationId: "S1", sessionId: "S1" });
    expect(cs.changes["temp.ts"]).toBeTruthy();
    expect(fs.readFileSync(brain(dir).map, "utf8")).toContain("temp.ts");

    // Revert (delete it) -> reconcile -> gone from BOTH the change set and the map.
    fs.rmSync(path.join(dir, "temp.ts"));
    cs = reconcileAndSync(dir, config, { incarnationId: "S1", sessionId: "S1" });
    expect(cs.changes["temp.ts"]).toBeUndefined();
    expect(fs.readFileSync(brain(dir).map, "utf8")).not.toContain("temp.ts");
  });

  it("marks the set degraded when the baseline was missing (rebuilt at reconcile)", () => {
    const dir = gitProject();
    updateSession(dir, "S1", (s) => { s.status = "active"; s.sessionId = "S1"; });
    // No baseline written -> reconcile creates one and flags degraded.
    const cs = reconcileAndSync(dir, config, { incarnationId: "S1", sessionId: "S1" });
    expect(cs.status).toBe("degraded");
    expect(cs.degradedReason).toContain("missing");
  });
});
