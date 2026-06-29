import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { looksSecret } from "../src/guard/secrets.js";
import { evaluateWrite } from "../src/guard/policy.js";
import { parseNeverDo } from "../src/state/formats.js";
import { makeContext, toolRemember } from "../src/mcp/tools.js";
import { buildIndex, refreshFromQueue } from "../src/recall/indexer.js";
import { VectorStore } from "../src/recall/store.js";
import { enqueue } from "../src/recall/queue.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";
import { brain } from "../src/state/files.js";
import type { Embedder } from "../src/recall/embedder.js";

class StubEmbedder implements Embedder {
  dimensions() {
    return 3;
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => [t.length % 7, (t.length >> 1) % 5, 1]);
  }
}

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-r3-"));
  const b = brain(dir);
  fs.mkdirSync(path.join(b.dir, "recall"), { recursive: true });
  fs.writeFileSync(b.config, JSON.stringify(DEFAULT_CONFIG));
  fs.writeFileSync(b.knowledge, "# Knowledge\n\n## Preferences\n\n## Never Do\n\n## Notes\n");
  fs.writeFileSync(b.solutions, "[]");
  return dir;
}

describe("[P1] path globs in extraSecretGlobs", () => {
  it("matches by full relative path, not just basename", () => {
    expect(looksSecret("config/app.json", ["config/**"], "config/app.json")).toBe(true);
    expect(looksSecret("a/b/secrets/x.json", ["**/secrets/*.json"], "a/b/secrets/x.json")).toBe(true);
    expect(looksSecret("src/app.json", ["config/**"], "src/app.json")).toBe(false);
    // built-ins still match by basename regardless of path
    expect(looksSecret("deep/dir/id_rsa", [], "deep/dir/id_rsa")).toBe(true);
  });
});

describe("[P1] MultiEdit isn't bypassed by content rules", () => {
  it("a block rule fires on edits[].new_string", () => {
    const policy = {
      version: 1,
      rules: [{ id: "no-forbidden", message: "no", severity: "block" as const, content: "FORBIDDEN" }],
    };
    // Simulate what pre-write extracts from a MultiEdit payload.
    const multiEditContent = [{ new_string: "ok" }, { new_string: "has FORBIDDEN token" }]
      .map((e) => e.new_string)
      .join("\n");
    const r = evaluateWrite(policy, {
      relPath: "src/a.ts",
      content: multiEditContent,
      blockSecrets: false,
      extraSecretGlobs: [],
    });
    expect(r.block).toBe(true);
  });
});

describe("[P1] remember(Never Do) is parseable", () => {
  it("inserts under the heading so parseNeverDo reads it", () => {
    const dir = project();
    const ctx = makeContext(dir);
    toolRemember(ctx, "Never use eval", "Never Do");
    const text = fs.readFileSync(brain(dir).knowledge, "utf8");
    expect(parseNeverDo(text).some((e) => e.includes("Never use eval"))).toBe(true);
    // and it must NOT have landed under ## Notes
    const notesPart = text.slice(text.indexOf("## Notes"));
    expect(notesPart).not.toContain("Never use eval");
  });
});

describe("[P2] incremental recall drops emptied/deleted sources", () => {
  it("removes embeddings when a file is emptied", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-r3idx-"));
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(brain(dir).dir, "recall"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "alpha beta gamma content here");
    const config = { ...DEFAULT_CONFIG, map: { ...DEFAULT_CONFIG.map, respectGitignore: false } };
    const embedder = new StubEmbedder();

    await buildIndex(dir, config, embedder);
    let store = new VectorStore(brain(dir).vectors);
    expect(store.sources().has("src/a.ts")).toBe(true);

    // Empty the file, queue it, refresh → its old embeddings must be gone.
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "");
    enqueue(dir, "src/a.ts");
    await refreshFromQueue(dir, config, embedder);
    store = new VectorStore(brain(dir).vectors);
    expect(store.sources().has("src/a.ts")).toBe(false);
  });
});

describe("[P1] hooks exit immediately (no ~4s stdin lingering)", () => {
  it("pre-write returns well under the old 4s timer", () => {
    const distHooks = path.resolve("dist/hooks");
    if (!fs.existsSync(distHooks)) return; // skip if not built
    const dir = project();
    // Reproduce the real install layout: compiled hooks + a commonjs marker so
    // the CJS bundle runs correctly inside this "type":"module" repo.
    const hooksDir = brain(dir).hooksDir;
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const f of fs.readdirSync(distHooks)) {
      fs.copyFileSync(path.join(distHooks, f), path.join(hooksDir, f));
    }
    fs.writeFileSync(path.join(hooksDir, "package.json"), JSON.stringify({ type: "commonjs" }));

    const start = Date.now();
    execFileSync("node", [path.join(hooksDir, "pre-write.js")], {
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "src/x.ts", content: "ok" } }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, PACKMIND_ROOT: dir },
      timeout: 5000,
    });
    expect(Date.now() - start).toBeLessThan(2000); // was ~4000 before the fix
  });
});
