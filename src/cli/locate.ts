import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)); // dist/cli at runtime

export const PACKAGE_ROOT = path.resolve(here, "..", "..");
export const TEMPLATES_DIR = path.join(PACKAGE_ROOT, "src", "templates");
export const HOOKS_DIST_DIR = path.join(PACKAGE_ROOT, "dist", "hooks");

export function pkgVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")).version as string) ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
