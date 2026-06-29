import * as os from "node:os";

export const onWindows = process.platform === "win32";
export const onMac = process.platform === "darwin";

export function homeDirectory(): string {
  return os.homedir();
}

/** PackMind's user-global cache/config root (models, registry). */
/** PackMind's user-global cache/config root. Overridable via PACKMIND_HOME so
 * tests (and isolated installs) never touch the real ~/.packmind. */
export function userRoot(): string {
  return process.env.PACKMIND_HOME || `${os.homedir()}/.packmind`;
}
