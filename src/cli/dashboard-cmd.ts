import { execFile } from "node:child_process";
import chalk from "chalk";
import { requireProject } from "./ctx.js";
import { startDashboard } from "../dashboard/server.js";
import { onWindows, onMac } from "../util/platform.js";

/** Open a URL in the default browser without invoking a shell (no injection). */
function openBrowser(url: string): void {
  const [cmd, args] = onMac
    ? ["open", [url]]
    : onWindows
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  execFile(cmd, args as string[], () => {
    /* ignore: user can open the URL manually */
  });
}

export async function runDashboard(opts: { port?: string; open?: boolean } = {}): Promise<void> {
  const { projectRoot } = requireProject();
  const preferred = opts.port ? parseInt(opts.port, 10) : 7878;
  const handle = await startDashboard(projectRoot, preferred);

  console.log(
    "\n" + chalk.bold.cyan("PackMind dashboard") + " running (loopback only)\n" +
      `  ${chalk.bold(handle.url)}\n\n` +
      chalk.dim("  Token-protected · bound to 127.0.0.1 · Ctrl+C to stop\n"),
  );
  if (opts.open !== false) openBrowser(handle.url);

  const shutdown = () => {
    handle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // Keep the process alive.
  await new Promise<void>(() => {});
}
