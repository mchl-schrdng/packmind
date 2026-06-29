import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildMapWith, mapIsStale, scanProject } from "../src/state/mapper.js";
import { parseMap } from "../src/state/formats.js";
import { confineToRoot } from "../src/guard/path-guard.js";
import { exactEnabled } from "../src/cost/exact.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";
import { brain } from "../src/state/files.js";

function project(): { dir: string; config: typeof DEFAULT_CONFIG } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-found-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(brain(dir).dir, "recall"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(dir, "src", "b.ts"), "export const b = 2;\n");
  // Disable gitignore so the temp files are always mapped.
  const config = { ...DEFAULT_CONFIG, map: { ...DEFAULT_CONFIG.map, respectGitignore: false } };
  return { dir, config };
}

describe("[P1] exact token counter is actually used", () => {
  it("buildMapWith routes every file's tokens through the injected counter", async () => {
    const { dir, config } = project();
    const seen: string[] = [];
    const counter = async (content: string, hint: string) => {
      seen.push(hint);
      return 999; // sentinel exact count
    };
    const { content } = await buildMapWith(dir, config, counter);
    const entries = [...parseMap(content).values()].flat();
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.tokens === 999)).toBe(true); // exact count applied
    expect(seen.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("exactEnabled honors the config mode", () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(exactEnabled("never")).toBe(false);
    expect(exactEnabled("always")).toBe(true);
    expect(exactEnabled("auto")).toBe(false); // no key
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(exactEnabled("auto")).toBe(true); // key present
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  });
});

describe("[P2] scan --check detects content changes, not just count", () => {
  it("is not stale right after a scan", () => {
    const { dir, config } = project();
    scanProject(dir, config);
    expect(mapIsStale(dir, config)).toBe(false);
  });

  it("flags staleness when a file's content changes (file count unchanged)", () => {
    const { dir, config } = project();
    scanProject(dir, config);
    // Same number of files, but one is edited after the scan. Force a clearly
    // later mtime so the test doesn't depend on sub-millisecond timing.
    const f = path.join(dir, "src", "a.ts");
    fs.writeFileSync(f, "// changed\n".repeat(80));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(f, future, future);
    expect(mapIsStale(dir, config)).toBe(true);
  });

  it("ignores the timestamp line (unchanged sources are never flagged stale)", () => {
    const { dir, config } = project();
    scanProject(dir, config);
    // The map header carries an auto-updated timestamp; normalized comparison
    // must treat the unchanged project as up to date regardless.
    expect(mapIsStale(dir, config)).toBe(false);
  });
});

describe("[P1] path confinement", () => {
  it("rejects paths outside the project root", () => {
    const root = "/proj";
    expect(confineToRoot(root, "../../etc/passwd")).toBeNull();
    expect(confineToRoot(root, "/etc/passwd")).toBeNull();
    expect(confineToRoot(root, "src/in.ts")).toBe("/proj/src/in.ts");
  });
});
