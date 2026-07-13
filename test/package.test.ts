import { describe, it, expect, beforeAll } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { readTicket } from "../src/state/resume.js";

const repo = process.cwd();
const built = fs.existsSync(path.join(repo, "dist", "hooks", "stop-failure.js"));

// Real-package E2E: pack the tarball npm would publish, extract it, link the
// repo's node_modules for runtime deps (offline), and drive the INSTALLED
// files: init, the compiled stop-failure hook, a ticket, and maintain.
describe.skipIf(!built)("[P1] published tarball", () => {
  let pkgDir: string;

  beforeAll(() => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pack-"));
    const out = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", work], {
      cwd: repo, encoding: "utf8",
    }).trim().split("\n").pop()!;
    const tarball = path.join(work, out);

    const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
    expect(listing).toContain("package/dist/hooks/stop-failure.js");
    expect(listing).toContain("package/dist/bin/packmind.js");
    expect(listing).toContain("package/README.md");

    execFileSync("tar", ["-xzf", tarball, "-C", work]);
    pkgDir = path.join(work, "package");
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(pkgDir, "node_modules"));
  }, 120_000);

  it("init + stop-failure hook + resume ticket + maintain work from the installed package", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pack-proj-"));
    const env = { ...process.env, PACKMIND_ROOT: project };
    const cli = path.join(pkgDir, "dist", "bin", "packmind.js");

    // init from the packaged CLI
    execFileSync(process.execPath, [cli, "init"], { cwd: project, env });
    expect(fs.existsSync(path.join(project, ".packmind", "hooks", "stop-failure.js"))).toBe(true);
    const settings = JSON.parse(fs.readFileSync(path.join(project, ".claude", "settings.json"), "utf8"));
    expect(JSON.stringify(settings.hooks.StopFailure)).toContain("stop-failure.js");

    // the INSTALLED hook (copied into the project by init) creates a ticket
    execFileSync(process.execPath, [path.join(project, ".packmind", "hooks", "stop-failure.js")], {
      input: JSON.stringify({ hook_event_name: "StopFailure", session_id: "pack-1", error: "rate_limit" }),
      env,
    });
    expect(readTicket(project, "pack-1")!.status).toBe("blocked");

    // resume and maintain are in the packaged --help
    const help = execFileSync(process.execPath, [cli, "--help"], { cwd: project, env, encoding: "utf8" });
    expect(help).toContain("resume");
    expect(help).toContain("maintain");

    // maintain from the packaged CLI: exit 0, quiet
    const ok = spawnSync(process.execPath, [cli, "maintain", "--quiet"], { cwd: project, env, encoding: "utf8" });
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);

    // invalid keep-backups: exit 1; concurrent lock: exit 3
    const bad = spawnSync(process.execPath, [cli, "maintain", "--quiet", "--keep-backups", "0"], { cwd: project, env, encoding: "utf8" });
    expect(bad.status).toBe(1);
    fs.mkdirSync(path.join(project, ".packmind", "state", "maintain.lock"), { recursive: true });
    const locked = spawnSync(process.execPath, [cli, "maintain", "--quiet"], { cwd: project, env, encoding: "utf8" });
    expect(locked.status).toBe(3);
  }, 120_000);
});
