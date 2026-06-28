import * as path from "node:path";
import * as fs from "node:fs";

/** Name of PackMind's per-project state directory. */
export const STATE_DIR = ".packmind";

/** Convert OS-specific separators to POSIX slashes for stable comparisons. */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function stateDirFor(projectRoot: string): string {
  return path.join(projectRoot, STATE_DIR);
}

export function stateFile(projectRoot: string, ...parts: string[]): string {
  return path.join(projectRoot, STATE_DIR, ...parts);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function relativePosix(from: string, to: string): string {
  return toPosix(path.relative(from, to));
}
