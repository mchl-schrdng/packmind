import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { buildMap, scanProject, countMapEntries, currentMapEntries } from "../state/mapper.js";

export function runScan(opts: { check?: boolean } = {}): void {
  const { projectRoot, config } = requireProject();
  if (opts.check) {
    const fresh = buildMap(projectRoot, config);
    const drift = Math.abs(countMapEntries(fresh.content) - currentMapEntries(projectRoot));
    if (drift > 0) {
      console.error(chalk.yellow(`map.md is stale (${drift} file(s) differ). Run \`packmind scan\`.`));
      process.exit(1);
    }
    console.log(chalk.green("✓ map.md is up to date."));
    return;
  }
  const count = scanProject(projectRoot, config);
  console.log(chalk.cyan(`✓ Mapped ${count} files into map.md`));
}
