import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { withLock } from "../src/util/fs-atomic.js";

function tmpTarget(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lock-"));
  return path.join(dir, "state.json");
}

describe("withLock", () => {
  it("runs the body and returns its value when the lock is free", () => {
    const target = tmpTarget();
    let ran = false;
    const out = withLock(target, () => {
      ran = true;
      return 42;
    });
    expect(ran).toBe(true);
    expect(out).toBe(42);
    // Lock directory is released afterwards.
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
  });

  it("throws and does NOT run the body when the lock is held (no silent unlocked write)", () => {
    const target = tmpTarget();
    // Simulate a live concurrent writer: a fresh, non-stale lock directory.
    fs.mkdirSync(`${target}.lock`);
    let ran = false;
    expect(() => withLock(target, () => { ran = true; })).toThrow(/could not acquire lock/);
    expect(ran).toBe(false); // the body must never run unlocked
    // We don't own the lock, so we must not have removed it.
    expect(fs.existsSync(`${target}.lock`)).toBe(true);
  });

  it("reclaims a stale lock and runs the body", () => {
    const target = tmpTarget();
    fs.mkdirSync(`${target}.lock`);
    // Age the lock well past the 10s TTL so it is considered abandoned.
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(`${target}.lock`, old, old);
    let ran = false;
    withLock(target, () => { ran = true; });
    expect(ran).toBe(true);
  });
});
