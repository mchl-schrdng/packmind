import { execFileSync } from "node:child_process";

/** A path plus its two-letter porcelain XY status code (e.g. ".M", "A.", "??"). */
export interface PorcelainEntry {
  path: string;
  xy: string;
}

export interface PorcelainStatus {
  changed: PorcelainEntry[];
  renames: Array<{ from: string; to: string }>;
}

/**
 * Parse `git status --porcelain=v2 -z` output. Records are NUL-delimited; a
 * type-2 (rename/copy) record is immediately followed by its original path as a
 * separate NUL field. Paths are unquoted (safe under -z), so they may contain
 * spaces. Ignored (`!`) records are skipped.
 */
export function parsePorcelainV2(zOutput: string): PorcelainStatus {
  const fields = zOutput.split("\0");
  const changed: PorcelainEntry[] = [];
  const renames: Array<{ from: string; to: string }> = [];

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    const type = f[0];
    if (type === "1") {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const parts = f.split(" ");
      const path = parts.slice(8).join(" ");
      if (path) changed.push({ path, xy: parts[1] ?? "" });
    } else if (type === "2") {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <Xscore> <path> \0 <origPath>
      const parts = f.split(" ");
      const to = parts.slice(9).join(" ");
      const from = fields[++i] ?? "";
      if (to && from) renames.push({ from, to });
      else if (to) changed.push({ path: to, xy: parts[1] ?? "" });
    } else if (type === "?") {
      const path = f.slice(2);
      if (path) changed.push({ path, xy: "??" });
    } else if (type === "u") {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const parts = f.split(" ");
      const path = parts.slice(10).join(" ");
      if (path) changed.push({ path, xy: parts[1] ?? "" });
    }
    // "!" ignored entries are intentionally skipped.
  }
  return { changed, renames };
}

/** True if `root` is inside a git work tree (cheap check, no shell). */
export function isGitRepo(root: string): boolean {
  try {
    const out = execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Current porcelain-v2 status for the repo at `root`, rename-detected and
 * NUL-delimited. Runs git without a shell and caps output/time. Returns null if
 * git is unavailable or errors, so the caller can fall back to a manifest.
 */
export function gitStatus(root: string): PorcelainStatus | null {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "status", "--porcelain=v2", "--find-renames", "-z"],
      { encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
    return parsePorcelainV2(out);
  } catch {
    return null;
  }
}
