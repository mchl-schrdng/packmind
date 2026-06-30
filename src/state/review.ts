import { execFileSync } from "node:child_process";

const LADDER =
  "Decision ladder (stop at the first that holds): 1) Does it need to exist? 2) Already in this codebase? Reuse it. 3) Stdlib? 4) Native platform feature? 5) Installed dependency? 6) One line? 7) Only then, the minimum that works. Never simplify away input validation, error handling, security, or accessibility.";

/**
 * Current diff for review: working tree vs HEAD by default, or vs a base ref.
 * Returns "" (not a throw) when there is no git, no repo, or no changes, so the
 * caller can render a clean "nothing to review" message.
 */
export function gitDiff(projectRoot: string, base?: string): string {
  try {
    const args = base ? ["diff", base] : ["diff", "HEAD"];
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

/** Wrap a diff with the lean ladder and a delete-list instruction for Claude. */
export function reviewPayload(diff: string): string {
  if (!diff.trim()) return "Nothing to review: the git diff is empty.";
  return [
    "Review this diff for over-engineering using the lean decision ladder, then hand back a delete-list: what to remove or simplify, and why. Do not flag anything that protects input validation, error handling, security, or accessibility.",
    "",
    LADDER,
    "",
    "--- DIFF ---",
    diff,
  ].join("\n");
}
