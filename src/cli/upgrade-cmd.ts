import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { pkgVersion } from "./locate.js";

const LATEST_URL = "https://registry.npmjs.org/packmind/latest";

export type PackageManager = "pnpm" | "yarn" | "npm";

/**
 * Compare two `x.y.z` versions. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Any pre-release suffix (`-rc.1`) is ignored - we only ship plain releases.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Guess which package manager owns the global install, from the module's own
 * path (pnpm and yarn use recognizable global directories; npm is the default).
 */
export function detectPackageManager(modulePath: string): PackageManager {
  const p = modulePath.replace(/\\/g, "/").toLowerCase();
  if (p.includes("/pnpm/") || p.includes("/pnpm-global/") || p.includes("/.pnpm")) return "pnpm";
  if (p.includes("/yarn/") || p.includes("/.yarn")) return "yarn";
  return "npm";
}

/** The install-latest command (argv form) for a package manager. */
export function upgradeCommand(pm: PackageManager): string[] {
  if (pm === "pnpm") return ["pnpm", "add", "-g", "packmind@latest"];
  if (pm === "yarn") return ["yarn", "global", "add", "packmind@latest"];
  return ["npm", "install", "-g", "packmind@latest"];
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(LATEST_URL, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Upgrade PackMind itself. `--check` only reports; otherwise it runs the global
 * install for the detected package manager and then refreshes registered
 * projects via a fresh `packmind update`. Fails loudly with the exact command if
 * the install can't run (e.g. permissions).
 */
export async function runUpgrade(opts: { check?: boolean } = {}): Promise<void> {
  const current = pkgVersion();
  const latest = await fetchLatestVersion();
  if (!latest) {
    console.error(chalk.yellow("Could not reach the npm registry to check for updates (are you offline?)."));
    process.exit(1);
  }

  if (compareVersions(current, latest) >= 0) {
    console.log(chalk.green(`✓ PackMind is up to date (${current}).`));
    return;
  }

  const pm = detectPackageManager(fileURLToPath(import.meta.url));
  const cmd = upgradeCommand(pm);
  const cmdStr = cmd.join(" ");

  if (opts.check) {
    console.log(chalk.cyan(`A newer PackMind is available: ${current} → ${latest}`));
    console.log(`  Upgrade with: ${chalk.bold(cmdStr)}`);
    console.log(`  Then refresh projects: ${chalk.bold("packmind update")}`);
    return;
  }

  console.log(chalk.cyan(`Upgrading PackMind ${current} → ${latest} (${pm})...`));
  try {
    execFileSync(cmd[0], cmd.slice(1), { stdio: "inherit" });
  } catch {
    console.error(chalk.red(`✗ Upgrade failed. Run it yourself:\n    ${cmdStr}`));
    process.exit(1);
  }
  console.log(chalk.green(`✓ Upgraded to ${latest}. Refreshing registered projects...`));

  // Run the NOW-installed version to re-copy hooks etc. Best effort: if it can't
  // be invoked (PATH/Windows quirks), tell the user the one command to run.
  try {
    execFileSync("packmind", ["update"], { stdio: "inherit", shell: process.platform === "win32" });
  } catch {
    console.log(chalk.yellow(`Run ${chalk.bold("packmind update")} to refresh your projects to ${latest}.`));
  }
}
