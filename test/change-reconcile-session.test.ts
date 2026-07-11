import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createBaseline, reconcileSession } from "../src/change/baseline.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

const config = { ...DEFAULT_CONFIG, map: { ...DEFAULT_CONFIG.map, respectGitignore: false } };
const write = (dir: string, rel: string, content: string) => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};
const kinds = (dir: string, baseline: ReturnType<typeof createBaseline>) =>
  reconcileSession(dir, config, baseline).map((c) => `${c.kind} ${c.path}`).sort();

function gitInit(dir: string): void {
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  execFileSync("git", ["-C", dir, "commit", "--allow-empty", "-qm", "root"]);
}

describe("[P1] reconcileSession (git)", () => {
  it("detects session add/modify/delete and ignores pre-existing dirt", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rsg-"));
    gitInit(dir);
    write(dir, "a.ts", "A");
    write(dir, "b.ts", "B");
    write(dir, "d.ts", "D"); // will be dirtied pre-baseline but NOT touched in-session
    execFileSync("git", ["-C", dir, "add", "."]);
    execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);

    // Pre-baseline dirt: a.ts and d.ts already modified before the session starts.
    write(dir, "a.ts", "A-dirty");
    write(dir, "d.ts", "D-dirty");

    const baseline = createBaseline(dir, config, { incarnationId: "inc1" });

    // Session changes: a.ts changed FURTHER, c.ts added, b.ts deleted. d.ts untouched.
    write(dir, "a.ts", "A-dirty-more");
    write(dir, "c.ts", "C");
    fs.rmSync(path.join(dir, "b.ts"));

    expect(kinds(dir, baseline)).toEqual(["add c.ts", "delete b.ts", "modify a.ts"]);
  });
});

describe("[P1] reconcileSession (non-git manifest)", () => {
  it("detects add/modify/delete via fingerprint manifest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rsm-"));
    write(dir, "a.ts", "A");
    write(dir, "b.ts", "B");

    const baseline = createBaseline(dir, config, { incarnationId: "inc1" });
    expect(baseline.kind).toBe("manifest");

    write(dir, "a.ts", "A2"); // modify
    fs.rmSync(path.join(dir, "b.ts")); // delete
    write(dir, "c.ts", "C"); // add

    expect(kinds(dir, baseline)).toEqual(["add c.ts", "delete b.ts", "modify a.ts"]);
  });

  it("a file restored to baseline content is not a net change", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rsm2-"));
    write(dir, "a.ts", "A");
    const baseline = createBaseline(dir, config, { incarnationId: "inc1" });
    write(dir, "a.ts", "changed");
    write(dir, "a.ts", "A"); // restored
    expect(kinds(dir, baseline)).toEqual([]);
  });
});
