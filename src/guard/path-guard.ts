import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Canonicalize against the real filesystem: resolve the deepest ancestor that
 * actually exists and re-append the non-existent remainder. Lexical checks
 * alone are not enough in either direction: a symlinked ancestor INSIDE the
 * project can redirect a lexically-in-root path outside it, and an aliased
 * ancestor (a symlink to the project, or a case-aliased path on
 * case-insensitive filesystems) makes an in-root location arrive without the
 * root as a string prefix.
 */
function canonicalize(p: string): string {
  let cur = p;
  let suffix = "";
  for (;;) {
    try {
      // .native (realpath(3)) also normalizes character case on
      // case-insensitive filesystems; the JS implementation does not.
      const real = fs.realpathSync.native(cur);
      return suffix ? path.join(real, suffix) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p; // nothing on the path exists
      suffix = suffix ? path.join(path.basename(cur), suffix) : path.basename(cur);
      cur = parent;
    }
  }
}

/**
 * Resolve `candidate` and confirm its real location stays within `root`.
 * Returns the canonical absolute path, or null if it escapes (path traversal
 * or a symlinked ancestor that redirects outside root). Never throws.
 */
export function confineToRoot(root: string, candidate: string): string | null {
  const base = canonicalize(path.resolve(root));
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(base, candidate);
  const canon = canonicalize(resolved);
  const rel = path.relative(base, canon);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) return null;
  return canon;
}

/** Equal-path test by full resolution (avoids suffix-match false positives). */
export function samePath(root: string, a: string, b: string): boolean {
  const ra = confineToRoot(root, a);
  const rb = confineToRoot(root, b);
  return ra !== null && rb !== null && ra === rb;
}
