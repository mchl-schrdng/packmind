import { writeJson, writeText } from "../util/fs-atomic.js";
import { brain } from "./files.js";
import { writeEffective } from "../guard/practices.js";
import { enqueue } from "../recall/queue.js";
import type { Config } from "./schema.js";
import type { Rule } from "../guard/policy.js";

/**
 * Domain mutations that own a primary file PLUS its derived state. Any surface
 * that changes policy or knowledge (dashboard, CLI, MCP) must go through these
 * so the primary write and its downstream regeneration never drift apart - the
 * failure mode the hooks hit when they read guard.effective.json / the vector
 * index rather than the file the UI wrote.
 */

/** Persist local policy rules AND regenerate the effective guard set hooks read. */
export function savePolicy(root: string, config: Config, rules: Rule[]): void {
  writeJson(brain(root).policy, { version: 1, rules });
  // guard.effective.json = DEFAULT_POLICY + active packs + this local policy.
  writeEffective(root, config);
}

/** Persist knowledge.md AND queue it so recall re-embeds the change. */
export function saveKnowledge(root: string, text: string): void {
  writeText(brain(root).knowledge, text);
  enqueue(root, ".packmind/knowledge.md");
}
