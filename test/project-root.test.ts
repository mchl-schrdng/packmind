import { describe, it, expect, afterEach } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { findRoot } from "../src/state/project.js";

const savedHome = process.env.PACKMIND_HOME;

afterEach(() => {
  if (savedHome === undefined) delete process.env.PACKMIND_HOME;
  else process.env.PACKMIND_HOME = savedHome;
});

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

describe("[regression] findRoot ignores the global ~/.packmind cache", () => {
  it("does not treat the global cache dir as a project root", () => {
    // Simulate a home whose global cache lives at <home>/.packmind, with a
    // marker-less working directory beneath it. The global cache must not be
    // mistaken for per-project state (which would resolve up to home and trip
    // the init guard).
    const home = tmp("pm-home-");
    process.env.PACKMIND_HOME = path.join(home, ".packmind");
    fs.mkdirSync(path.join(home, ".packmind"), { recursive: true });
    const work = path.join(home, "Desktop", "project");
    fs.mkdirSync(work, { recursive: true });

    const root = findRoot(work);

    expect(root).not.toBe(home);
    expect(root).toBe(work); // falls back to the dir we actually started in
  });

  it("still detects a genuine per-project .packmind/", () => {
    const home = tmp("pm-home-");
    process.env.PACKMIND_HOME = path.join(home, ".packmind");
    const proj = path.join(home, "real-project");
    const nested = path.join(proj, "src", "deep");
    fs.mkdirSync(path.join(proj, ".packmind"), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });

    expect(findRoot(nested)).toBe(proj);
  });
});
