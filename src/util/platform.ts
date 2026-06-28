import * as os from "node:os";

export const onWindows = process.platform === "win32";
export const onMac = process.platform === "darwin";

export function homeDirectory(): string {
  return os.homedir();
}

/** PackMind's user-global cache/config root (models, registry). */
export function userRoot(): string {
  return `${os.homedir()}/.packmind`;
}
