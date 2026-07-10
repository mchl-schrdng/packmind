import * as path from "node:path";
import * as fs from "node:fs";

/**
 * True if `target`'s real location stays under `root` on disk. Lexical checks
 * alone are not enough: a symlinked ancestor INSIDE the project can redirect a
 * lexically-in-root path to a real location outside it. We canonicalize the
 * deepest ancestor that actually exists (the shallowest a symlink could hide at)
 * and confirm it - and thus everything we'd create below it - stays under root.
 */
function realWithinRoot(base: string, target: string): boolean {
  let realBase: string;
  try {
    realBase = fs.realpathSync(base);
  } catch {
    return true; // root itself is missing: nothing to confine against
  }
  let cur = target;
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      const rel = path.relative(realBase, real);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return true; // reached filesystem root, nothing existed
      cur = parent;
    }
  }
}

/**
 * Resolve `candidate` and confirm it stays within `root`. Returns the resolved
 * absolute path, or null if it escapes (path traversal or a symlinked ancestor
 * that redirects outside root). Never throws.
 */
export function confineToRoot(root: string, candidate: string): string | null {
  const base = path.resolve(root);
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(base, candidate);
  const rel = path.relative(base, resolved);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) return null;
  if (!realWithinRoot(base, resolved)) return null;
  return resolved;
}

/** Equal-path test by full resolution (avoids suffix-match false positives). */
export function samePath(root: string, a: string, b: string): boolean {
  const ra = confineToRoot(root, a);
  const rb = confineToRoot(root, b);
  return ra !== null && rb !== null && ra === rb;
}
