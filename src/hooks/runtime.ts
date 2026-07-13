/**
 * Zero-dependency runtime for PackMind's standalone hook scripts.
 *
 * Hooks are copied into a user's `.packmind/hooks/` and executed by Claude Code
 * as plain `node` scripts, so this module imports ONLY Node builtins. The
 * parsers here mirror src/state/formats.ts, the secret matcher mirrors
 * src/guard/secrets.ts, the path guard mirrors src/guard/path-guard.ts, the
 * policy evaluation mirrors src/guard/policy.ts, and the resume-ticket store
 * mirrors src/state/resume.ts; a parity test pins each mirror to its twin.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// --- project + brain paths --------------------------------------------------
export function projectRoot(): string {
  return process.env.PACKMIND_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
export function stateDir(): string {
  return path.join(projectRoot(), ".packmind");
}
export function brainPath(...parts: string[]): string {
  return path.join(stateDir(), ...parts);
}
/** Exit silently when the project doesn't use PackMind. */
export function requireState(): void {
  if (!fs.existsSync(stateDir())) process.exit(0);
}

// --- atomic + locked IO -----------------------------------------------------
const FALLBACK = new Set(["EBUSY", "EACCES", "EPERM", "EXDEV"]);
function spin(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* brief spin */
  }
}
export function withLock<T>(target: string, body: () => T): T {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lock = `${target}.lock`;
  let held = false;
  for (let i = 0; i < 60; i++) {
    try {
      fs.mkdirSync(lock);
      held = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 10_000) {
          fs.rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* retry */
      }
      spin(20);
    }
  }
  // Never run the body unlocked: a concurrent writer still holds the lock, so
  // proceeding here would risk a lost update to a shared file. Fail loudly.
  if (!held) {
    throw new Error(`packmind: could not acquire lock for ${target} (held by another writer)`);
  }
  try {
    return body();
  } finally {
    try {
      fs.rmSync(lock, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
function atomic(target: string, data: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (!FALLBACK.has((err as NodeJS.ErrnoException).code ?? "")) throw err;
    fs.writeFileSync(target, data, "utf8");
  }
}
export function readText(target: string, fallback = ""): string {
  try {
    return fs.readFileSync(target, "utf8");
  } catch {
    return fallback;
  }
}
export function readJson<T>(target: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8")) as T;
  } catch {
    return fallback;
  }
}
/**
 * Read-modify-write a JSON file atomically: the read and the write happen inside
 * one lock, so concurrent writers can't lose each other's update (the failure
 * mode of a plain readJson + writeJson pair). Mirrors util/fs-atomic.ts.
 */
export function updateJson<T>(target: string, fallback: T, update: (current: T) => T): void {
  withLock(target, () => {
    const current = readJson<T>(target, fallback);
    atomic(target, JSON.stringify(update(current), null, 2) + "\n");
  });
}

// --- knowledge format (mirror of state/formats.ts) ---------------------------
export function lines(text: string): string[] {
  return text.split(/\r?\n/);
}
export function parseNeverDo(knowledge: string): string[] {
  const result: string[] = [];
  let active = false;
  for (const line of lines(knowledge)) {
    if (/^##\s+/.test(line)) {
      active = /^##\s+Never\s*Do\b/i.test(line);
      continue;
    }
    if (!active) continue;
    const m = line.match(/^[-*]\s+(?:\[[\d-]+\]\s*)?(.+?)\s*$/);
    if (m) result.push(m[1]);
  }
  return result;
}

// --- secrets (mirror of guard/secrets.ts) -----------------------------------
const SECRET_GLOBS = [
  ".env", ".env.*", "*.env", "*.pem", "*.key", "*.p8", "*.p12", "*.pfx", "*.ppk",
  "*.keystore", "*.jks", "*.cer", "*.crt", "*.der", "id_rsa*", "id_dsa*",
  "id_ecdsa*", "id_ed25519*", "credentials", "credentials.*", ".netrc", ".npmrc",
  ".pypirc", "*.secret", "*.secrets", "secrets.*", "service-account*.json",
  "*.kdbx", "*.gpg", "*.asc",
];
function toRe(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${body}$`, "i");
}
function pathRe(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*|\*|\?/g, (m) => (m === "**" ? ".*" : m === "*" ? "[^/]*" : "."));
  return new RegExp(`^${body}$`, "i");
}
const SECRET_RES = SECRET_GLOBS.map(toRe);
export function looksSecret(file: string, extra: string[] = [], relPath?: string): boolean {
  const base = path.basename(file);
  if (SECRET_RES.some((re) => re.test(base))) return true;
  const full = (relPath ?? file).split(path.sep).join("/");
  return extra.some((g) => toRe(g).test(base) || pathRe(g).test(full));
}

// --- path guard (mirror of guard/path-guard.ts) -----------------------------
function canonicalize(p: string): string {
  let cur = p;
  let suffix = "";
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      return suffix ? path.join(real, suffix) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      suffix = suffix ? path.join(path.basename(cur), suffix) : path.basename(cur);
      cur = parent;
    }
  }
}
export function confineToRoot(root: string, candidate: string): string | null {
  const base = canonicalize(path.resolve(root));
  const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(base, candidate);
  const canon = canonicalize(resolved);
  const rel = path.relative(base, canon);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) return null;
  return canon;
}

// --- guard policy (mirror of guard/policy.ts) -------------------------------
export interface Rule {
  id: string;
  message: string;
  severity: "warn" | "block";
  pathGlob?: string;
  content?: string;
  secretFile?: boolean;
}
export interface Finding {
  ruleId: string;
  message: string;
  severity: "warn" | "block";
}
function pathGlobRe(glob: string): RegExp {
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*|\*|\?/g, (m) => (m === "**" ? ".*" : m === "*" ? "[^/]*" : "."));
  return new RegExp(`^${body}$`, "i");
}
export function evaluateWrite(
  rules: Rule[],
  input: { relPath: string; content: string; blockSecrets: boolean; extraSecretGlobs: string[] },
): { findings: Finding[]; block: boolean } {
  const findings: Finding[] = [];
  const isSecret = looksSecret(input.relPath, input.extraSecretGlobs, input.relPath);
  for (const rule of rules ?? []) {
    const conditions: boolean[] = [];
    if (rule.secretFile) conditions.push(isSecret);
    if (rule.pathGlob) conditions.push(pathGlobRe(rule.pathGlob).test(input.relPath));
    if (rule.content) {
      try {
        conditions.push(new RegExp(rule.content).test(input.content));
      } catch {
        conditions.push(false);
      }
    }
    if (conditions.length > 0 && conditions.every(Boolean)) {
      findings.push({ ruleId: rule.id, message: rule.message, severity: rule.severity });
    }
  }
  if (input.blockSecrets && isSecret) {
    findings.push({
      ruleId: "block-secrets",
      message: "Writing to a secrets file is blocked by policy (guard.blockSecrets).",
      severity: "block",
    });
  }
  return { findings, block: findings.some((f) => f.severity === "block") };
}

// --- config (minimal read) --------------------------------------------------
export interface HookConfig {
  extraSecretGlobs: string[];
  blockSecrets: boolean;
}
export function hookConfig(): HookConfig {
  const raw = readJson<any>(brainPath("config.json"), {});
  // extraSecretGlobs lived under map.* before 2.0; keep reading it so a
  // config.json written by an older install stays effective.
  const globs = Array.isArray(raw?.guard?.extraSecretGlobs)
    ? raw.guard.extraSecretGlobs
    : Array.isArray(raw?.map?.extraSecretGlobs) ? raw.map.extraSecretGlobs : [];
  return {
    extraSecretGlobs: globs,
    blockSecrets: raw?.guard?.blockSecrets === true,
  };
}

// --- Claude Code hook IO ----------------------------------------------------
export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer); // don't let the safety timer keep the process alive
      resolve(chunks.length ? Buffer.concat(chunks).toString("utf8") : "{}");
    };
    try {
      process.stdin.on("data", (c) => chunks.push(Buffer.from(c)));
      process.stdin.on("end", finish);
      process.stdin.on("error", finish);
    } catch {
      finish();
    }
    // Safety fallback only. `unref()` ensures the process can exit the instant
    // stdin ends, instead of lingering ~4s for this timer on every hook.
    timer = setTimeout(finish, 4000);
    timer.unref?.();
  });
}
export function parseInput(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
export function emitContext(event: string, text: string): void {
  if (!text) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
}
/** PreToolUse deny (hard block) with a reason Claude sees. */
export function emitDeny(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
  );
}

// --- resume tickets (rate-limited session recovery) ---------------------------
/** Mirror of src/state/resume.ts's ResumeTicketV1 (hooks are zero-dep). */
export interface ResumeTicket {
  version: 1;
  sessionId: string;
  status: "blocked" | "launching" | "resumed";
  createdAt: string;
  updatedAt: string;
  resetAt?: string;
  reconcileRequested: boolean;
}

/** Same hashing as src/state/resume.ts ticketFile - pinned by tests. */
export function resumeTicketFile(sessionId: string): string {
  const hash = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  return brainPath("state", "resume-tickets", `${hash}.json`);
}

/**
 * Extract a rate-limit reset time from the DOCUMENTED StopFailure surface:
 * `error_details`, a human-readable string (e.g. "Rate limit exceeded.
 * Please retry after 60 seconds."). No structured reset field exists in the
 * docs, so only two clear patterns are accepted - a "retry after/in N
 * seconds|minutes|hours" phrase, or an explicit ISO-8601 timestamp. Anything
 * else returns undefined: a reset time is never invented.
 */
export function extractResetAt(input: Record<string, any>, nowMs: number): string | undefined {
  const details = input?.error_details;
  if (typeof details !== "string" || !details.trim()) return undefined;

  const rel = details.match(/retry\s+(?:after|in)\s+(\d+)\s*(seconds?|minutes?|hours?)/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = n * (unit.startsWith("h") ? 3_600_000 : unit.startsWith("m") ? 60_000 : 1000);
    if (n > 0) return new Date(nowMs + ms).toISOString();
  }
  const iso = details.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/);
  if (iso) {
    const ms = Date.parse(iso[0]);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return undefined;
}

/** Create-or-reset the session's ticket to blocked (StopFailure rate_limit). */
export function blockResumeTicket(sessionId: string, now: string, resetAt?: string): void {
  updateJson<ResumeTicket | null>(resumeTicketFile(sessionId), null, (prev) => {
    const kept = resetAt ?? prev?.resetAt;
    return {
      version: 1,
      sessionId,
      status: "blocked",
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      ...(kept ? { resetAt: kept } : {}),
      reconcileRequested: true,
    };
  });
}

/**
 * SessionStart saw the session again: the resume is confirmed, drop the
 * ticket. Removal happens under the same lock blockResumeTicket writes with,
 * so a concurrent StopFailure either lands before (its write is deleted with
 * the confirmation - correct, the session IS back) or after (a fresh blocked
 * ticket is recreated and survives - correct, a new limit was hit).
 */
export function clearResumeTicket(sessionId: string): void {
  const file = resumeTicketFile(sessionId);
  if (!fs.existsSync(file)) return;
  withLock(file, () => {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* best effort */
    }
  });
}
