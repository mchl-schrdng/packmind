import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { harvestDebt } from "../src/state/debt.js";
import { DEFAULT_CONFIG } from "../src/state/schema.js";

/**
 * harvestDebt scans real source for `packmind:` deferred-shortcut markers. It
 * must catch the common comment styles and must NOT catch the uppercase
 * PACKMIND:START/END wiring sentinels or plain prose mentions.
 */
describe("harvestDebt", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-debt-"));
    fs.writeFileSync(
      path.join(root, "a.ts"),
      "const x = 1;\n// packmind: O(n^2) scan; upgrade to an index if N grows\nconst y = 2;\n",
    );
    fs.writeFileSync(path.join(root, "b.py"), "# packmind: naive heuristic; revisit with real data\n");
    fs.writeFileSync(path.join(root, "c.ts"), "/* packmind: global lock; shard later */\n");
    // Not debt: uppercase wiring sentinel + a prose mention with no comment leader.
    fs.writeFileSync(path.join(root, "d.md"), "<!-- PACKMIND:START -->\ntalking about packmind: the tool\n");
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("finds markers across //, #, and /* */ comment styles", () => {
    const items = harvestDebt(root, DEFAULT_CONFIG);
    const byFile = Object.fromEntries(items.map((i) => [i.file, i]));
    expect(items).toHaveLength(3);
    expect(byFile["a.ts"]).toMatchObject({ line: 2, note: "O(n^2) scan; upgrade to an index if N grows" });
    expect(byFile["b.py"].note).toMatch(/naive heuristic/);
    expect(byFile["c.ts"].note).toBe("global lock; shard later");
  });

  it("ignores the uppercase wiring sentinel and prose mentions", () => {
    const items = harvestDebt(root, DEFAULT_CONFIG);
    expect(items.some((i) => i.file === "d.md")).toBe(false);
  });
});
