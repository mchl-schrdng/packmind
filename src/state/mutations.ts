import { writeJson, writeText } from "../util/fs-atomic.js";
import { brain } from "./files.js";
import { writeEffective } from "../guard/policy.js";
import type { Rule } from "../guard/policy.js";

/**
 * Domain mutations that own a primary file PLUS its derived state. Any surface
 * that changes policy or knowledge (CLI, MCP) must go through these so the
 * primary write and its downstream regeneration never drift apart.
 */

/** Persist local policy rules AND regenerate the effective guard set hooks read. */
export function savePolicy(root: string, rules: Rule[]): void {
  writeJson(brain(root).policy, { version: 1, rules });
  writeEffective(root);
}

/** Persist knowledge.md. */
export function saveKnowledge(root: string, text: string): void {
  writeText(brain(root).knowledge, text);
}
