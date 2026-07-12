import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { brain } from "../src/state/files.js";
import { readSessionRecord } from "../src/state/session.js";
import { reconcileAndSync } from "../src/change/service.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

const distHooks = path.resolve("dist/hooks");
const built = fs.existsSync(path.join(distHooks, "session-start.js"));

function gitProject(): { dir: string; hooksDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cbb-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  const b = brain(dir);
  fs.mkdirSync(path.join(b.dir, "state", "sessions"), { recursive: true });
  fs.writeFileSync(b.config, JSON.stringify(DEFAULT_CONFIG));
  fs.writeFileSync(b.knowledge, "# Knowledge\n");
  const hooksDir = b.hooksDir;
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const f of fs.readdirSync(distHooks)) fs.copyFileSync(path.join(distHooks, f), path.join(hooksDir, f));
  fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "commonjs" }));
  return { dir, hooksDir };
}

function plainProject(): { dir: string; hooksDir: string } {
  // Same as gitProject but WITHOUT git init (non-git manifest path).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cbbng-"));
  const b = brain(dir);
  fs.mkdirSync(path.join(b.dir, "state", "sessions"), { recursive: true });
  fs.writeFileSync(b.config, JSON.stringify(DEFAULT_CONFIG));
  fs.writeFileSync(b.knowledge, "# Knowledge\n");
  const hooksDir = b.hooksDir;
  fs.mkdirSync(hooksDir, { recursive: true });
  for (const f of fs.readdirSync(distHooks)) fs.copyFileSync(path.join(distHooks, f), path.join(hooksDir, f));
  fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "commonjs" }));
  return { dir, hooksDir };
}

function run(hooksDir: string, name: string, stdin: unknown, dir: string): void {
  execFileSync("node", [path.join(hooksDir, name)], {
    input: JSON.stringify(stdin),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PACKMIND_ROOT: dir },
    timeout: 5000,
  });
}
const jsonFiles = (dir: string) => {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
};

describe.skipIf(!built)("[P1] change-intelligence: SessionStart creates a git baseline + change set", () => {
  it("writes a baseline and change set for a new incarnation in a git repo", () => {
    const { dir, hooksDir } = gitProject();
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);

    expect(jsonFiles(brain(dir).changeBaselineDir).length).toBe(1);
    expect(jsonFiles(brain(dir).changeSetDir).length).toBe(1);

    const baseline = JSON.parse(
      fs.readFileSync(path.join(brain(dir).changeBaselineDir, jsonFiles(brain(dir).changeBaselineDir)[0]), "utf8"),
    );
    expect(baseline.kind).toBe("git");
    expect(baseline.version).toBe(1);
  });

  it("Stop reconciles a Bash/external-created file (no Write hook) and syncs the map", () => {
    const { dir, hooksDir } = gitProject();
    fs.writeFileSync(path.join(dir, "seed.ts"), "seed");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);

    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);

    // External change: create a file as if Bash/a generator did it (no PostToolUse).
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "gen.ts"), "// generated\nexport const g = 1;\n");

    run(hooksDir, "stop.js", { session_id: "S1" }, dir);

    const csName = jsonFiles(brain(dir).changeSetDir)[0];
    const cs = JSON.parse(fs.readFileSync(path.join(brain(dir).changeSetDir, csName), "utf8"));
    expect(Object.keys(cs.changes)).toContain("src/gen.ts");
    expect(cs.changes["src/gen.ts"].kind).toBe("add");
    expect(cs.changes["src/gen.ts"].map).toBe("current");

    // The map was synchronized to the externally-created file.
    expect(fs.readFileSync(brain(dir).map, "utf8")).toContain("gen.ts");
  });

  it("reverting a change across two Stops leaves the map clean (no stale entry)", () => {
    const { dir, hooksDir } = gitProject();
    fs.writeFileSync(path.join(dir, "seed.ts"), "seed");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);

    // Add then Stop: mapped.
    fs.writeFileSync(path.join(dir, "temporary.ts"), "export const t = 1;\n");
    run(hooksDir, "stop.js", { session_id: "S1" }, dir);
    expect(fs.readFileSync(brain(dir).map, "utf8")).toContain("temporary.ts");

    // Revert (delete) then Stop: gone from change set AND map.
    fs.rmSync(path.join(dir, "temporary.ts"));
    run(hooksDir, "stop.js", { session_id: "S1" }, dir);
    const cs = JSON.parse(fs.readFileSync(path.join(brain(dir).changeSetDir, jsonFiles(brain(dir).changeSetDir)[0]), "utf8"));
    expect(cs.changes["temporary.ts"]).toBeUndefined();
    expect(fs.readFileSync(brain(dir).map, "utf8")).not.toContain("temporary.ts");
  });

  it("non-git: SessionStart captures a manifest baseline so a later change is detected by reconcile", () => {
    const { dir, hooksDir } = plainProject();
    fs.writeFileSync(path.join(dir, "seed.ts"), "seed"); // eligible file present at baseline
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);

    const baseName = jsonFiles(brain(dir).changeBaselineDir)[0];
    const baseline = JSON.parse(fs.readFileSync(path.join(brain(dir).changeBaselineDir, baseName), "utf8"));
    expect(baseline.kind).toBe("manifest");
    expect(Object.keys(baseline.hashes)).toContain("seed.ts");

    // A change appears AFTER the baseline (external).
    fs.writeFileSync(path.join(dir, "external.ts"), "export const e = 1;\n");

    const incarnationId = readSessionRecord(dir, "S1")!.id;
    const cs = reconcileAndSync(dir, DEFAULT_CONFIG, { incarnationId, sessionId: "S1" });
    expect(cs.changes["external.ts"].kind).toBe("add");
    expect(cs.status).not.toBe("degraded"); // baseline existed -> not degraded
  });

  it("a direct write to an ineligible file (binary) never enters map/change set", () => {
    const { dir, hooksDir } = gitProject();
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);
    fs.writeFileSync(path.join(dir, "logo.png"), "PNGDATA");
    // Simulate the PostToolUse hook for that write.
    run(hooksDir, "post-write.js", { tool_name: "Write", tool_input: { file_path: "logo.png", content: "PNGDATA" }, session_id: "S1" }, dir);
    let map = "";
    try { map = fs.readFileSync(brain(dir).map, "utf8"); } catch { /* no map written */ }
    expect(map).not.toContain("logo.png");
  });

  it("an empty eligible file is still mapped by reconcile", () => {
    const { dir, hooksDir } = gitProject();
    fs.writeFileSync(path.join(dir, "seed.ts"), "seed");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);
    fs.writeFileSync(path.join(dir, "empty.ts"), ""); // empty but eligible
    run(hooksDir, "stop.js", { session_id: "S1" }, dir);
    const cs = JSON.parse(fs.readFileSync(path.join(brain(dir).changeSetDir, jsonFiles(brain(dir).changeSetDir)[0]), "utf8"));
    expect(cs.changes["empty.ts"].kind).toBe("add");
    expect(cs.changes["empty.ts"].map).toBe("current");
    expect(fs.readFileSync(brain(dir).map, "utf8")).toContain("empty.ts");
  });

  it("a secret file recorded via PostToolBatch is never read or mapped at Stop", () => {
    const { dir, hooksDir } = gitProject();
    fs.writeFileSync(path.join(dir, "seed.ts"), "seed");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);

    // A secret file (matches the built-in `credentials.*` glob) is written.
    fs.writeFileSync(path.join(dir, "credentials.txt"), "// PACKMIND_AUDIT_SECRET_9f3c\nkey=abc\n");
    // PostToolBatch sees the direct Write of it.
    run(hooksDir, "post-tool-batch.js", { session_id: "S1", tool_calls: [{ tool_name: "Write", tool_input: { file_path: "credentials.txt" } }] }, dir);
    // Stop reconciles + repairs departed paths - must NOT read the secret.
    run(hooksDir, "stop.js", { session_id: "S1" }, dir);

    let map = "";
    try { map = fs.readFileSync(brain(dir).map, "utf8"); } catch { /* no map written = clean */ }
    expect(map).not.toContain("credentials.txt");
    expect(map).not.toContain("PACKMIND_AUDIT_SECRET");
    const cs = JSON.parse(fs.readFileSync(path.join(brain(dir).changeSetDir, jsonFiles(brain(dir).changeSetDir)[0]), "utf8"));
    expect(cs.changes["credentials.txt"]).toBeUndefined();
  });

  it("a reverted rename (a->b->a) leaves the map with the original path", () => {
    const { dir, hooksDir } = gitProject();
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);

    execFileSync("git", ["-C", dir, "mv", "a.ts", "b.ts"]);
    run(hooksDir, "stop.js", { session_id: "S1" }, dir);
    let map = fs.readFileSync(brain(dir).map, "utf8");
    expect(map).toContain("b.ts");

    execFileSync("git", ["-C", dir, "mv", "b.ts", "a.ts"]); // revert
    run(hooksDir, "stop.js", { session_id: "S1" }, dir);
    map = fs.readFileSync(brain(dir).map, "utf8");
    expect(map).toContain("a.ts");
    expect(map).not.toMatch(/`b\.ts`/); // b.ts entry gone
  });

  it("emits watchPaths for tracked eligible files in a clean git repo", () => {
    const { dir, hooksDir } = gitProject();
    fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);
    const out = execFileSync("node", [path.join(hooksDir, "session-start.js")], {
      input: JSON.stringify({ session_id: "S1", source: "startup" }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PACKMIND_ROOT: dir },
      encoding: "utf8",
      timeout: 5000,
    });
    const wp: string[] = JSON.parse(out).hookSpecificOutput?.watchPaths ?? [];
    expect(wp.some((p) => p.endsWith(`${path.sep}a.ts`))).toBe(true); // clean repo still watches tracked files
  });

  it("FileChanged records an eligible watched change and ignores an ineligible one", () => {
    const { dir, hooksDir } = gitProject();
    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "x.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(dir, "credentials.txt"), "secret");

    run(hooksDir, "file-changed.js", { session_id: "S1", file_path: "src/x.ts", event: "add" }, dir);
    run(hooksDir, "file-changed.js", { session_id: "S1", file_path: "credentials.txt", event: "add" }, dir);

    const cs = JSON.parse(fs.readFileSync(path.join(brain(dir).changeSetDir, jsonFiles(brain(dir).changeSetDir)[0]), "utf8"));
    expect(cs.changes["src/x.ts"]?.sources).toContain("file-changed");
    expect(cs.changes["credentials.txt"]).toBeUndefined(); // ineligible ignored
  });

  it("Stop reconciles an external deletion and removes it from the map", () => {
    const { dir, hooksDir } = gitProject();
    fs.writeFileSync(path.join(dir, "doomed.ts"), "bye");
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "seed"]);

    run(hooksDir, "session-start.js", { session_id: "S1", source: "startup" }, dir);
    // Put it on the map first (as if scanned), then delete it externally.
    fs.writeFileSync(brain(dir).map, "# Project Map\n\n## ./\n\n- `doomed.ts` · ~2 tok\n");
    fs.rmSync(path.join(dir, "doomed.ts"));

    run(hooksDir, "stop.js", { session_id: "S1" }, dir);

    const cs = JSON.parse(fs.readFileSync(path.join(brain(dir).changeSetDir, jsonFiles(brain(dir).changeSetDir)[0]), "utf8"));
    expect(cs.changes["doomed.ts"].kind).toBe("delete");
    expect(fs.readFileSync(brain(dir).map, "utf8")).not.toContain("doomed.ts");
  });
});
