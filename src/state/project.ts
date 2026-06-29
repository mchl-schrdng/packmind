import * as fs from "node:fs";
import * as path from "node:path";
import { homeDirectory, userRoot } from "../util/platform.js";
import { STATE_DIR } from "../util/paths.js";

const ROOT_MARKERS = [
  ".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "deno.json",
  "pom.xml", "build.gradle", "composer.json", "Gemfile", "Makefile",
];

/**
 * Resolve the project root. Honors an explicit env override
 * (PACKMIND_ROOT / CLAUDE_PROJECT_DIR), then walks up to a marker or an existing
 * `.packmind/`. Never ascends above the user's home directory.
 *
 * The global cache lives at `~/.packmind` (see {@link userRoot}) and shares the
 * `.packmind` name with per-project state, so it is explicitly excluded here —
 * otherwise a marker-less directory under home would resolve up to the home
 * directory and trip the init guard.
 */
export function findRoot(start?: string): string {
  const override = process.env.PACKMIND_ROOT || process.env.CLAUDE_PROJECT_DIR;
  let dir = path.resolve(override || start || process.cwd());
  const fsRoot = path.parse(dir).root;
  const home = homeDirectory();
  const globalState = path.resolve(userRoot());

  for (let i = 0; i < 30; i++) {
    const stateHere = path.join(dir, STATE_DIR);
    if (path.resolve(stateHere) !== globalState && fs.existsSync(stateHere)) return dir;
    if (ROOT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
    const up = path.dirname(dir);
    if (up === dir || up === fsRoot || dir === home) break;
    dir = up;
  }
  return path.resolve(override || start || process.cwd());
}

export function isHome(dir: string): boolean {
  return path.resolve(dir) === path.resolve(homeDirectory());
}
