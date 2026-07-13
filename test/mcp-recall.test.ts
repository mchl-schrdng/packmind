import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeContext, toolRecall } from "../src/mcp/tools.js";

function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-recall-"));
  fs.mkdirSync(path.join(root, ".packmind"), { recursive: true });
  fs.writeFileSync(path.join(root, ".packmind", "config.json"), "{}");
  return root;
}

describe("lexical recall over brain files", () => {
  it("ranks the matching solution first and includes its fix", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, ".packmind", "solutions.json"),
      JSON.stringify([
        { id: "sol-1", error: "postgres connection timeout under load", fix: "raise pool max and add statement_timeout", tags: ["db"] },
        { id: "sol-2", error: "css flexbox overflow on safari", fix: "min-width: 0 on the flex child", tags: ["css"] },
      ]),
    );
    fs.writeFileSync(
      path.join(root, ".packmind", "knowledge.md"),
      "# Knowledge\n\n## Decisions\n\n- 2026-07-13: use pnpm for everything\n",
    );
    const out = toolRecall(makeContext(root), "postgres timeout");
    const firstHit = out.split("\n\n")[0];
    expect(firstHit).toContain("postgres connection timeout");
    expect(out).toContain("statement_timeout");
    expect(out).not.toContain("flexbox");
  });

  it("searches knowledge.md entries too", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, ".packmind", "knowledge.md"),
      "# Knowledge\n\n## Never Do\n\n- never use lstat before read, always openSync with O_NOFOLLOW\n",
    );
    const out = toolRecall(makeContext(root), "lstat NOFOLLOW read");
    expect(out).toContain("O_NOFOLLOW");
  });

  it("never throws when brain files are missing and says so", () => {
    const root = project();
    const out = toolRecall(makeContext(root), "anything at all");
    expect(typeof out).toBe("string");
    expect(out).toMatch(/no relevant memory/i);
  });

  it("returns no-match for an unrelated query instead of noise", () => {
    const root = project();
    fs.writeFileSync(
      path.join(root, ".packmind", "solutions.json"),
      JSON.stringify([{ id: "sol-1", error: "postgres connection timeout", fix: "pool" }]),
    );
    expect(toolRecall(makeContext(root), "zzz qqq www")).toMatch(/no relevant memory/i);
  });
});
