import * as path from "node:path";

/**
 * Files whose contents must never be ingested into PackMind's brain files, and
 * which the write guard can optionally hard-block. Matched against the basename,
 * case-insensitively, as simple globs (`*` and `?`).
 */
export const SECRET_GLOBS: string[] = [
  ".env", ".env.*", "*.env",
  "*.pem", "*.key", "*.p8", "*.p12", "*.pfx", "*.ppk",
  "*.keystore", "*.jks", "*.cer", "*.crt", "*.der",
  "id_rsa*", "id_dsa*", "id_ecdsa*", "id_ed25519*",
  "credentials", "credentials.*", ".netrc", ".npmrc", ".pypirc",
  "*.secret", "*.secrets", "secrets.*", "service-account*.json",
  "*.kdbx", "*.gpg", "*.asc",
];

function toRegExp(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}

const compiled = SECRET_GLOBS.map(toRegExp);

export function looksSecret(filePath: string, extraGlobs: string[] = []): boolean {
  const base = path.basename(filePath);
  if (compiled.some((re) => re.test(base))) return true;
  return extraGlobs.map(toRegExp).some((re) => re.test(base));
}
