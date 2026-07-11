import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { brain } from "../src/state/files.js";
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
});
