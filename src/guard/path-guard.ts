import * as path from "node:path";

/**
 * Resolve `candidate` and confirm it stays within `root`. Returns the resolved
 * absolute path, or null if it escapes (path traversal). Never throws.
 */
export function confineToRoot(root: string, candidate: string): string | null {
  const base = path.resolve(root);
  const resolved = path.isAbsolute(candidate)
    ? path.resolve(candidate)
    : path.resolve(base, candidate);
  const rel = path.relative(base, resolved);
  if (rel === "") return resolved;
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

export function withinRoot(root: string, candidate: string): boolean {
  return confineToRoot(root, candidate) !== null;
}

/** Equal-path test by full resolution (avoids suffix-match false positives). */
export function samePath(root: string, a: string, b: string): boolean {
  const ra = confineToRoot(root, a);
  const rb = confineToRoot(root, b);
  return ra !== null && rb !== null && ra === rb;
}
