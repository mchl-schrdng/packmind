import * as fs from "node:fs";
import * as path from "node:path";
import { TEMPLATES_DIR } from "./locate.js";

/** Brain files created once and never overwritten afterward (they hold user data). */
export const CREATE_IF_MISSING = [
  "config.json", "knowledge.md", "journal.md", "map.md", "handoff.md",
  "solutions.json", "usage.json", "identity.md", "policy.json",
];

function copyTemplate(name: string, dest: string): void {
  const src = path.join(TEMPLATES_DIR, name);
  if (fs.existsSync(src)) fs.writeFileSync(dest, fs.readFileSync(src));
}

function seedIfMissing(name: string, dir: string): void {
  const dest = path.join(dir, name);
  if (fs.existsSync(dest)) return;
  let content = fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf8");
  if (name === "usage.json") {
    content = content.replace('"createdAt": ""', `"createdAt": "${new Date().toISOString()}"`);
  }
  fs.writeFileSync(dest, content);
}

/**
 * Ensure a project's `.packmind/` has its seed files: create any missing data
 * file from CREATE_IF_MISSING (never overwriting user data), then (re)write the
 * managed `.gitattributes` and `.gitignore`. Shared by init and update so an
 * upgraded install also picks up brain files introduced in a newer version.
 */
export function seedBrainFiles(brainDir: string): void {
  for (const name of CREATE_IF_MISSING) seedIfMissing(name, brainDir);
  copyTemplate("gitattributes", path.join(brainDir, ".gitattributes"));
  copyTemplate("gitignore", path.join(brainDir, ".gitignore"));
}
