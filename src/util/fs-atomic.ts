import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

/**
 * Crash-safe, concurrency-safe file IO.
 *
 * Writes go to a temp sibling and are atomically renamed into place. A coarse
 * advisory lock (an exclusively-created `<file>.lock` directory) serializes
 * writers so concurrent hook processes can't interleave and corrupt a shared
 * file. Stale locks (older than LOCK_TTL_MS) are reclaimed.
 */

const FALLBACK_CODES = new Set(["EBUSY", "EACCES", "EPERM", "EXDEV"]);
const LOCK_TRIES = 60;
const LOCK_WAIT_MS = 20;
const LOCK_TTL_MS = 10_000;

function busyWait(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* hooks are short synchronous scripts; a brief spin is acceptable */
  }
}

export function withLock<T>(target: string, body: () => T): T {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const lock = `${target}.lock`;
  let held = false;

  for (let i = 0; i < LOCK_TRIES; i++) {
    try {
      fs.mkdirSync(lock);
      held = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_TTL_MS) {
          fs.rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* lock disappeared; loop and retry */
      }
      busyWait(LOCK_WAIT_MS);
    }
  }

  // Never run the body unlocked: a concurrent writer still holds the lock, so
  // proceeding here would risk a lost update to a shared file (usage.json,
  // session state, the map, queues). Fail loudly instead - callers (fail-safe
  // hooks, or the CLI/MCP) decide how to handle it.
  if (!held) {
    throw new Error(`packmind: could not acquire lock for ${target} (held by another writer)`);
  }

  try {
    return body();
  } finally {
    try {
      fs.rmSync(lock, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

function writeAtomic(target: string, data: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temp, data, "utf8");
    fs.renameSync(temp, target);
  } catch (err) {
    try {
      fs.unlinkSync(temp);
    } catch {
      /* temp may not exist */
    }
    if (!FALLBACK_CODES.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
    fs.writeFileSync(target, data, "utf8");
  }
}

export function readTextOr(target: string, fallback = ""): string {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return fallback;
  }
}

export function writeText(target: string, data: string): void {
  withLock(target, () => writeAtomic(target, data));
}

export function appendLine(target: string, line: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  withLock(target, () => fs.appendFileSync(target, line, "utf8"));
}

export function readJsonOr<T>(target: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Like readJsonOr, but only the ABSENT case falls back. A file that exists but
 * fails to parse throws, so callers that read-modify-write a user-owned file
 * (e.g. .claude/settings.json, .mcp.json) never silently discard its contents
 * over a mere syntax error (trailing comma, BOM, JSONC comment).
 */
export function readJsonStrict<T>(target: string, fallback: T): T {
  let raw: string;
  try {
    raw = fs.readFileSync(target, "utf8");
  } catch {
    return fallback; // absent or unreadable: start fresh
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `packmind: ${target} exists but is not valid JSON (${(err as Error).message}). ` +
        `Refusing to overwrite it - fix or remove the file, then re-run.`,
    );
  }
}

export function writeJson(target: string, value: unknown): void {
  withLock(target, () => writeAtomic(target, JSON.stringify(value, null, 2) + "\n"));
}

/**
 * Read-modify-write a JSON file atomically: the read and the write happen inside
 * one lock, so concurrent writers can't lose each other's update (the failure
 * mode of a plain readJsonOr + writeJson pair).
 */
export function updateJson<T>(target: string, fallback: T, update: (current: T) => T): void {
  withLock(target, () => {
    const current = readJsonOr<T>(target, fallback);
    writeAtomic(target, JSON.stringify(update(current), null, 2) + "\n");
  });
}
