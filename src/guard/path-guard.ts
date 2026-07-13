import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Canonical on-disk form of an absolute path, resolving symlinks AND filesystem
 * case aliasing. `fs.realpathSync.native` needs the path to exist, so we resolve
 * the deepest ancestor that DOES exist (the shallowest point a symlink could
 * redirect from) and re-append the not-yet-created remainder. Using `.native`
 * (not the JS realpath) is what folds a case-aliased path like `-packmind` onto
 * its real `-PackMind` on a case-insensitive volume. Falls back to the lexical
 * absolute path when nothing on the way to it exists.
 */
function canonicalize(p: string): string {
  const abs = path.resolve(p);
  let cur = abs;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(cur);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs; // reached the fs root, nothing existed
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * Resolve `candidate` and confirm it stays within `root`. Returns the canonical
 * absolute path, or null if it escapes (path traversal or a symlinked ancestor
 * that redirects outside root). Both sides are canonicalized before the
 * containment check, so root and candidate expressed in DIFFERENT-but-equivalent
 * forms (a symlinked `/tmp` vs `/private/tmp`, or a case alias on a
 * case-insensitive volume) compare equal instead of being rejected as an escape.
 * That miscompare was a fail-open hole: the guard returned null and the write
 * hooks then skipped every rule for that path. Never throws.
 */
export function confineToRoot(root: string, candidate: string): string | null {
  const base = path.resolve(root);
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(base, candidate);
  const canonBase = canonicalize(base);
  const canonTarget = canonicalize(resolved);
  const rel = path.relative(canonBase, canonTarget);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) return null;
  return canonTarget;
}

/** Equal-path test by full resolution (avoids suffix-match false positives). */
export function samePath(root: string, a: string, b: string): boolean {
  const ra = confineToRoot(root, a);
  const rb = confineToRoot(root, b);
  return ra !== null && rb !== null && ra === rb;
}
