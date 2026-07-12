/**
 * Zero-dependency runtime for PackMind's standalone hook scripts.
 *
 * Hooks are copied into a user's `.packmind/hooks/` and executed by Claude Code
 * as plain `node` scripts, so this module imports ONLY Node builtins. The
 * format functions here mirror src/state/formats.ts, the secret matcher mirrors
 * src/guard/secrets.ts, and the estimator mirrors src/cost/estimator.ts; a
 * parity test pins each mirror to its canonical twin.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";

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
  // proceeding here would risk a lost update to a shared file (usage.json,
  // session state, the map, queues). Fail loudly instead.
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
export function writeText(target: string, data: string): void {
  withLock(target, () => atomic(target, data));
}
export function updateText(target: string, update: (current: string) => string): void {
  withLock(target, () => atomic(target, update(readText(target, ""))));
}
/** Locked add/update of one map.md entry (mirror of state/map-mutations.ts).
 * Returns the token estimate for the caller's journal line. */
export function upsertMapEntry(rel: string, content: string, model: string, prices: PriceOverrides): number {
  const dir = path.posix.dirname(rel);
  const section = dir === "." ? "./" : dir + "/";
  const file = path.posix.basename(rel);
  const tokens = estimateTokens(content, rel);
  updateText(brainPath("map.md"), (text) => {
    const map = parseMap(text);
    const entry: MapEntry = { file, description: describeLite(file, content), tokens, cost: inputCost(model, tokens, prices) };
    if (!map.has(section)) map.set(section, []);
    const list = map.get(section)!;
    const idx = list.findIndex((e) => e.file === file);
    if (idx >= 0) {
      if (!entry.description && list[idx].description) entry.description = list[idx].description;
      list[idx] = entry;
    } else {
      list.push(entry);
    }
    let count = 0;
    for (const [, l] of map) count += l.length;
    return serializeMap(map, { fileCount: count, updated: new Date().toISOString() });
  });
  return tokens;
}
/** Locked removal of one map.md entry (and its now-empty section). */
export function removeMapEntry(rel: string): void {
  const dir = path.posix.dirname(rel);
  const section = dir === "." ? "./" : dir + "/";
  const file = path.posix.basename(rel);
  updateText(brainPath("map.md"), (text) => {
    const map = parseMap(text);
    const list = map.get(section);
    if (list) {
      const idx = list.findIndex((e) => e.file === file);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) map.delete(section);
    }
    let count = 0;
    for (const [, l] of map) count += l.length;
    return serializeMap(map, { fileCount: count, updated: new Date().toISOString() });
  });
}
export function appendLine(target: string, line: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  withLock(target, () => fs.appendFileSync(target, line, "utf8"));
}
export function readJson<T>(target: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8")) as T;
  } catch {
    return fallback;
  }
}
export function writeJson(target: string, value: unknown): void {
  withLock(target, () => atomic(target, JSON.stringify(value, null, 2) + "\n"));
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

// --- map format (mirror of state/formats.ts) --------------------------------
export interface MapEntry {
  file: string;
  description: string;
  tokens: number;
  cost?: number;
}
const SECTION = /^##\s+(.+?)\s*$/;
const ENTRY = /^-\s+`([^`]+)`\s+·\s+~(\d+)\s+tok(?:\s+·\s+\$([\d.]+))?(?:\s+—\s+(.*\S))?\s*$/;
export function lines(text: string): string[] {
  return text.split(/\r?\n/);
}
export function parseMap(text: string): Map<string, MapEntry[]> {
  const out = new Map<string, MapEntry[]>();
  let section = "";
  for (const line of lines(text)) {
    const s = line.match(SECTION);
    if (s) {
      section = s[1].trim();
      if (!out.has(section)) out.set(section, []);
      continue;
    }
    if (!section) continue;
    const e = line.match(ENTRY);
    if (e) {
      out.get(section)!.push({
        file: e[1],
        tokens: parseInt(e[2], 10),
        cost: e[3] ? Number(e[3]) : undefined,
        description: e[4] ? e[4].trim() : "",
      });
    }
  }
  return out;
}
export function serializeMap(
  sections: Map<string, MapEntry[]>,
  meta: { fileCount: number; updated: string },
): string {
  const out: string[] = [
    "# Project Map",
    "",
    `_Maintained by PackMind · ${meta.fileCount} files · updated ${meta.updated}_`,
    "",
  ];
  for (const key of [...sections.keys()].sort()) {
    const entries = sections.get(key)!;
    if (entries.length === 0) continue;
    out.push(`## ${key}`, "");
    for (const e of [...entries].sort((a, b) => a.file.localeCompare(b.file))) {
      const cost = e.cost && e.cost > 0 ? ` · $${e.cost.toFixed(4)}` : "";
      const desc = e.description ? ` — ${e.description}` : "";
      out.push(`- \`${e.file}\` · ~${e.tokens} tok${cost}${desc}`);
    }
    out.push("");
  }
  return out.join("\n");
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

// --- tokens (mirror of cost/estimator.ts) -----------------------------------
const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".kt", ".c",
  ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".swift", ".scala", ".sh",
  ".css", ".scss", ".sql", ".json", ".yaml", ".yml", ".toml", ".xml", ".html",
]);
export function estimateTokens(text: string, hint?: string): number {
  if (!text) return 0;
  const ext = hint ? path.extname(hint).toLowerCase() : "";
  const charsPerToken = CODE_EXT.has(ext) ? 3.5 : 4.0;
  const byChars = text.length / charsPerToken;
  const words = text.trim().length ? text.trim().split(/\s+/).length : 0;
  const byWords = words / 0.75;
  return Math.max(1, Math.round((byChars + byWords) / 2));
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
function realWithinRoot(base: string, target: string): boolean {
  let realBase: string;
  try {
    realBase = fs.realpathSync(base);
  } catch {
    return true;
  }
  let cur = target;
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      const rel = path.relative(realBase, real);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return true;
      cur = parent;
    }
  }
}
export function confineToRoot(root: string, candidate: string): string | null {
  const base = path.resolve(root);
  const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(base, candidate);
  const rel = path.relative(base, resolved);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) return null;
  if (!realWithinRoot(base, resolved)) return null;
  return resolved;
}
export function samePath(root: string, a: string, b: string): boolean {
  const ra = confineToRoot(root, a);
  const rb = confineToRoot(root, b);
  return ra !== null && rb !== null && ra === rb;
}

// --- pricing (mirror of cost/pricing.ts) ------------------------------------
const PRICES: Record<string, { i: number; o: number }> = {
  "claude-opus-4-8": { i: 5, o: 25 },
  "claude-sonnet-4-6": { i: 3, o: 15 },
  "claude-haiku-4-5": { i: 1, o: 5 },
  "claude-fable-5": { i: 10, o: 50 },
};
function normModel(m: string): string {
  const s = m.toLowerCase();
  if (s.includes("opus")) return "claude-opus-4-8";
  if (s.includes("sonnet")) return "claude-sonnet-4-6";
  if (s.includes("haiku")) return "claude-haiku-4-5";
  if (s.includes("fable")) return "claude-fable-5";
  return "claude-opus-4-8";
}
export type PriceOverrides = Record<string, { inputPerMTok: number; outputPerMTok: number }>;
function rate(model: string, ov?: PriceOverrides): { i: number; o: number } {
  const o = ov?.[model] ?? ov?.[normModel(model)];
  if (o) return { i: o.inputPerMTok, o: o.outputPerMTok };
  return PRICES[normModel(model)] ?? PRICES["claude-opus-4-8"];
}
export function inputCost(model: string, tokens: number, ov?: PriceOverrides): number {
  return (tokens / 1_000_000) * rate(model, ov).i;
}
export function outputCost(model: string, tokens: number, ov?: PriceOverrides): number {
  return (tokens / 1_000_000) * rate(model, ov).o;
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

// --- light description for map upkeep ---------------------------------------
export function describeLite(file: string, content: string): string {
  const ext = path.extname(file).toLowerCase();
  const head = content.slice(0, 4096);
  if (ext === ".md" || ext === ".mdx") {
    const h = head.match(/^#{1,3}\s+(.+)$/m);
    if (h) return clip(h[1]);
  }
  for (const raw of head.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const c = line.match(/^\s*(?:\/\/+|#+|--|;|\*)\s?(.+)$/);
    if (c && c[1].trim().length > 3 && !/^[=*-]+$/.test(c[1].trim())) return clip(c[1]);
    break;
  }
  return "";
}
function clip(s: string, max = 90): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// --- config (minimal read) --------------------------------------------------
export interface HookConfig {
  model: string;
  extraSecretGlobs: string[];
  excludeDirs: string[];
  maxFiles: number;
  blockSecrets: boolean;
  recallEnabled: boolean;
  leanMode: string;
  prices: PriceOverrides;
}
export function hookConfig(): HookConfig {
  const raw = readJson<any>(brainPath("config.json"), {});
  return {
    model: typeof raw?.model === "string" ? raw.model : "claude-opus-4-8",
    extraSecretGlobs: Array.isArray(raw?.map?.extraSecretGlobs) ? raw.map.extraSecretGlobs : [],
    excludeDirs: Array.isArray(raw?.map?.excludeDirs) ? raw.map.excludeDirs : [],
    maxFiles: typeof raw?.map?.maxFiles === "number" ? raw.map.maxFiles : 4000,
    blockSecrets: raw?.guard?.blockSecrets === true,
    recallEnabled: raw?.recall?.enabled !== false,
    leanMode: typeof raw?.guard?.lean?.mode === "string" ? raw.guard.lean.mode : "lite",
    prices: raw?.cost?.prices && typeof raw.cost.prices === "object" ? raw.cost.prices : {},
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
/**
 * SessionStart output with optional `watchPaths` (absolute) for FileChanged.
 * watchPaths is a latency optimization for external edits to existing files -
 * reconciliation, not watching, is the completeness mechanism - so an unsupported
 * or partial watch list never affects correctness.
 */
export function emitSessionStart(text: string, watchPaths: string[]): void {
  const hookSpecificOutput: Record<string, unknown> = { hookEventName: "SessionStart" };
  if (text) hookSpecificOutput.additionalContext = text;
  if (watchPaths.length) hookSpecificOutput.watchPaths = watchPaths;
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}
/** PreToolUse deny (hard block) with a reason Claude sees. */
export function emitDeny(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    }),
  );
}

// --- session state ----------------------------------------------------------
export interface ReadRecord {
  count: number;
  tokens: number;
  cost: number;
  mtime: number;
  first: string;
}
export interface Session {
  id: string;
  started: string;
  sessionId?: string;
  transcriptPath?: string;
  status?: "active" | "suspended";
  lastEventAt?: string;
  initialSource?: string;
  lastSource?: string;
  model?: string;
  cwd?: string;
  reads: Record<string, ReadRecord>;
  writes: Array<{ file: string; action: string; tokens: number; at: string }>;
  editCounts: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  mapHits: number;
  mapMisses: number;
  dedupedReads: number;
  /** Stop-hook reminder latches so each nudge fires at most once per session. */
  notifiedWrites?: boolean;
  notifiedEdits?: string[];
  /** Lean-mode nudge latch (lite mode fires the ladder reminder once/session). */
  notifiedLean?: boolean;
  /** Compress-suggestion latch (fires once/session on a large non-source read). */
  notifiedCompress?: boolean;
  /** Practice-check latches so each session-level check fires at most once/session. */
  notifiedPractice?: string[];
  /** Evidence the agent recorded (via record_evidence) to satisfy practice checks. */
  evidence?: Array<{ check: string; detail?: string; at: string }>;
}
export function newSession(id: string): Session {
  return {
    id,
    started: new Date().toISOString(),
    reads: {},
    writes: [],
    editCounts: {},
    inputTokens: 0,
    outputTokens: 0,
    inputCost: 0,
    outputCost: 0,
    mapHits: 0,
    mapMisses: 0,
    dedupedReads: 0,
  };
}
// --- per-session lifecycle (mirror of state/session.ts) ---------------------
const REMOVE_REASONS = new Set([
  "clear", "logout", "prompt_input_exit", "bypass_permissions_disabled", "other",
]);
export interface SessionStartInput {
  source: string;
  now: string;
  newIncarnationId: string;
  sessionId: string;
  transcriptPath?: string;
  model?: string;
  cwd?: string;
}
export interface SessionEndInput { reason: string; now: string; }
export function sessionRawKey(input: Record<string, any>): string | null {
  const sid = input?.session_id;
  if (typeof sid === "string" && sid.trim()) return sid;
  const tp = input?.transcript_path;
  if (typeof tp === "string" && tp.trim()) return tp;
  return null;
}
export function sessionFile(rawKey: string): string {
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex").slice(0, 16);
  return brainPath("state", "sessions", `${hash}.json`);
}
export function freshRecord(input: SessionStartInput): Session {
  const s = newSession(input.newIncarnationId);
  s.started = input.now;
  s.sessionId = input.sessionId;
  if (input.transcriptPath) s.transcriptPath = input.transcriptPath;
  s.status = "active";
  s.lastEventAt = input.now;
  s.initialSource = input.source;
  s.lastSource = input.source;
  if (input.model) s.model = input.model;
  if (input.cwd) s.cwd = input.cwd;
  return s;
}
export function applySessionStart(
  existing: Session | null,
  input: SessionStartInput,
): { record: Session; fold: Session | null } {
  if (input.source === "clear" && existing) {
    return { record: freshRecord(input), fold: existing };
  }
  if (existing) {
    return {
      record: {
        ...existing,
        status: "active",
        lastEventAt: input.now,
        lastSource: input.source,
        model: input.model ?? existing.model,
      },
      fold: null,
    };
  }
  return { record: freshRecord(input), fold: null };
}
export function classifySessionEnd(reason: string): "remove" | "suspend" {
  return REMOVE_REASONS.has(reason) ? "remove" : "suspend";
}
export function applySessionEnd(
  existing: Session,
  input: SessionEndInput,
): { fold: Session; remove: boolean; record: Session | null } {
  if (classifySessionEnd(input.reason) === "remove") {
    return { fold: existing, remove: true, record: null };
  }
  return {
    fold: existing,
    remove: false,
    record: { ...existing, status: "suspended", lastEventAt: input.now },
  };
}
export function readSessionFor(rawKey: string): Session | null {
  return readJson<Session | null>(sessionFile(rawKey), null);
}
export function updateSession(rawKey: string, fn: (s: Session) => void): void {
  updateJson<Session | null>(sessionFile(rawKey), null, (prev) => {
    const s = prev ?? newSession(rawKey);
    fn(s);
    return s;
  });
}

// --- usage ledger fold (mirror of cost/ledger.ts commitSession) -------------
interface LedgerRow {
  id: string;
  sessionId?: string;
  started: string;
  ended: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  reads: number;
  writes: number;
  dedupedReads?: number;
  mapHits?: number;
  model?: string;
  initialSource?: string;
  lastSource?: string;
  status?: string;
  cwd?: string;
}
export function emptyLedger(model: string): LedgerLike {
  return {
    version: 2, model, createdAt: new Date().toISOString(),
    totals: { inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0, reads: 0, writes: 0, sessions: 0, dedupedReads: 0, mapHits: 0 },
    sessions: [],
  };
}
export interface LedgerLike {
  version?: number;
  model?: string;
  createdAt?: string;
  totals: {
    inputTokens: number;
    outputTokens: number;
    inputCost: number;
    outputCost: number;
    reads: number;
    writes: number;
    sessions: number;
    dedupedReads: number;
    mapHits: number;
  };
  sessions: LedgerRow[];
}

/**
 * Fold a session's CUMULATIVE counters into the lifetime ledger, upserting by
 * session id. The Stop hook fires once per TURN carrying cumulative session
 * totals, so a plain push+add would count each session quadratically; instead we
 * replace the existing row for this id and adjust totals by the delta. Naturally
 * idempotent (re-folding an identical session nets zero) and safe every turn.
 * `totals.sessions` counts distinct ids. Mirrors commitSession in cost/ledger.ts.
 */
export function foldSessionIntoLedger(ledger: LedgerLike, s: Session, endedAt: string): void {
  ledger.sessions = ledger.sessions ?? [];
  const row: LedgerRow = {
    id: s.id,
    sessionId: s.sessionId,
    started: s.started,
    ended: endedAt,
    inputTokens: s.inputTokens,
    outputTokens: s.outputTokens,
    inputCost: s.inputCost,
    outputCost: s.outputCost,
    reads: Object.keys(s.reads).length,
    writes: s.writes.length,
    dedupedReads: s.dedupedReads,
    mapHits: s.mapHits,
    model: s.model,
    initialSource: s.initialSource,
    lastSource: s.lastSource,
    status: s.status,
    cwd: s.cwd,
  };
  const t = ledger.totals;
  const apply = (r: LedgerRow, k: number): void => {
    t.inputTokens += k * r.inputTokens;
    t.outputTokens += k * r.outputTokens;
    t.inputCost += k * r.inputCost;
    t.outputCost += k * r.outputCost;
    t.reads += k * r.reads;
    t.writes += k * r.writes;
    t.dedupedReads += k * (r.dedupedReads ?? 0);
    t.mapHits += k * (r.mapHits ?? 0);
  };
  const i = ledger.sessions.findIndex((x) => x.id === s.id);
  if (i === -1) {
    ledger.sessions.push(row);
    t.sessions += 1;
    apply(row, 1);
  } else {
    apply(ledger.sessions[i], -1);
    ledger.sessions[i] = row;
    apply(row, 1);
  }
}

/**
 * Build the Stop-hook reminders, latching each on the session so a given nudge
 * fires at most once per session. Without these latches the Stop hook re-emits
 * the same reminder on every turn (the conditions stay true for the rest of the
 * session), and because emitting context from Stop re-invokes the agent, that
 * loops indefinitely. Mutates `session.notified*`; caller persists the session
 * when the returned array is non-empty.
 */
export function computeStopReminders(session: Session): string[] {
  const reminders: string[] = [];
  if (session.writes.length >= 3 && !session.notifiedWrites) {
    reminders.push("Several files changed - record durable lessons/decisions with the `remember` tool and any fixes with `record_solution`.");
    session.notifiedWrites = true;
  }
  const already = session.notifiedEdits ?? [];
  const heavy = Object.entries(session.editCounts).filter(([f, n]) => n >= 4 && !already.includes(f));
  if (heavy.length) {
    reminders.push(`Repeatedly edited ${heavy.map(([f]) => `\`${f}\``).join(", ")} - capture the root cause so it isn't rediscovered.`);
    session.notifiedEdits = [...already, ...heavy.map(([f]) => f)];
  }
  return reminders;
}

/**
 * Lean-mode nudge: a one-line reminder to climb the decision ladder in
 * PACKMIND.md (reuse what exists before writing new code) before a Write/Edit.
 * "lite" latches once per session (mirrors computeStopReminders); "full" returns
 * on every write; "off" or any other value is silent. Hook-only logic with no
 * canonical twin; the caller persists the session when this latches.
 */
export function leanNudge(mode: string, session: Session): string | null {
  if (mode !== "lite" && mode !== "full") return null;
  if (mode === "lite") {
    if (session.notifiedLean) return null;
    session.notifiedLean = true;
  }
  return "Lean check: reuse what exists (this codebase, stdlib, installed deps) before adding new code. Climb the ladder in PACKMIND.md, and leave a `packmind:` note for any deferred shortcut.";
}

// Large NON-source data formats worth shelving; source code is never suggested
// for compression because Claude needs it exact.
const COMPRESS_DATA_EXT = new Set([
  ".log", ".json", ".ndjson", ".jsonl", ".csv", ".tsv", ".txt", ".out", ".xml", ".yaml", ".yml",
]);
const COMPRESS_MIN_BYTES = 16 * 1024;

/**
 * Suggest compress() once per session when Claude is about to read a large
 * non-source data file. Silent for source, small files, or after it has fired.
 * Hook-only (no canonical twin); the caller persists the session when it fires.
 */
export function compressNudge(rel: string, bytes: number, session: Session): string | null {
  if (session.notifiedCompress) return null;
  if (bytes < COMPRESS_MIN_BYTES) return null;
  if (!COMPRESS_DATA_EXT.has(path.extname(rel).toLowerCase())) return null;
  session.notifiedCompress = true;
  return `\`${rel}\` is a large ${path.extname(rel)} file (~${Math.round(bytes / 1024)} KB). If you don't need it verbatim, read only the part you need, or read it then use compress() to keep the context lean.`;
}

// --- practice packs (session-level checks) ----------------------------------
export interface SessionCheck {
  id: string;
  message: string;
  /** Fire only if some file written this session matches one of these globs. */
  changedGlobs: string[];
  /** ...AND no file written this session matches any of these globs. */
  missingChangedGlobs?: string[];
  /** Suppressed while a recorded evidence entry has this `check` name. */
  needsEvidence?: string;
}

/**
 * Session-level practice-pack checks, evaluated at Stop: nudge when this session
 * wrote a file matching `changedGlobs` but none matching `missingChangedGlobs`
 * (e.g. "touched src/** but wrote no test"). A check whose `needsEvidence`
 * matches a recorded evidence entry is SUPPRESSED - not latched, so removing the
 * evidence lets it fire again (evidence is what keeps it quiet). Otherwise each
 * check latches by id so it nudges at most once per session. Hook-only (no
 * canonical twin, like leanNudge); the caller persists the session when the
 * returned array is non-empty. Reuses pathGlobRe against the same glob dialect
 * as evaluateWrite.
 */
export function computePracticeReminders(session: Session, checks: SessionCheck[], changedFiles?: string[]): string[] {
  const out: string[] = [];
  const latched = session.notifiedPractice ?? (session.notifiedPractice = []);
  // Prefer the canonical net change set (covers Bash/external/parallel changes);
  // fall back to the session's direct writes when no change set is available.
  const files = changedFiles ?? session.writes.map((w) => w.file);
  const evidence = session.evidence ?? [];
  const hit = (globs?: string[]): boolean =>
    !!globs && globs.some((g) => files.some((f) => pathGlobRe(g).test(f)));
  for (const c of checks ?? []) {
    if (latched.includes(c.id)) continue;
    if (c.needsEvidence && evidence.some((e) => e.check === c.needsEvidence)) continue;
    if (hit(c.changedGlobs) && !hit(c.missingChangedGlobs)) {
      out.push(c.message);
      latched.push(c.id);
    }
  }
  return out;
}

// --- recall queue (zero-dep enqueue) ----------------------------------------
// On-disk format is a `path -> generation` map; enqueue ALWAYS bumps the
// generation so a re-enqueue during embedding survives the indexer's ack. A
// legacy `string[]` queue migrates to generation 1. Mirrors recall/queue.ts;
// the canonical drain there and this enqueue must agree on the format.
function normalizeQueue(raw: unknown): Record<string, number> {
  if (Array.isArray(raw)) {
    const m: Record<string, number> = {};
    for (const p of raw) if (typeof p === "string") m[p] = 1;
    return m;
  }
  if (raw && typeof raw === "object") {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) m[k] = v;
    }
    return m;
  }
  return {};
}
export function enqueueRecall(relPath: string): void {
  // Atomic read-modify-write so two concurrent hook processes can't lose each
  // other's enqueue.
  updateJson<unknown>(brainPath("recall", "queue.json"), {}, (raw) => {
    const m = normalizeQueue(raw);
    m[relPath] = (m[relPath] ?? 0) + 1;
    return m;
  });
}

// --- change intelligence (mirror of src/change/*) ---------------------------
// The PURE functions below (parsePorcelainV2, computeNetChanges, reconcileGit)
// are byte-identical to their canonical twins and pinned by runtime-parity.
export type ChangeKind = "add" | "modify" | "delete" | "rename";
export type ChangeSource = "post-tool" | "file-changed" | "reconcile";
export interface PorcelainEntry { path: string; xy: string; }
export interface PorcelainStatus { changed: PorcelainEntry[]; renames: Array<{ from: string; to: string }>; }
export interface Snapshot { hashes: Record<string, string>; renames?: Array<{ from: string; to: string }>; }
export interface NetChange { path: string; kind: ChangeKind; previousPath?: string; }
export interface GitBaseline { status: PorcelainStatus; hashes: Record<string, string>; }
export interface GitCurrent { status: PorcelainStatus; hashes: Record<string, string>; }
export interface ChangeRecordV1 {
  path: string; kind: ChangeKind; previousPath?: string;
  firstSeenAt: string; lastSeenAt: string; sources: ChangeSource[];
  suspectedTools?: string[]; map: string; recall: string; error?: string;
}
export interface ChangeSetV1 {
  version: 1; incarnationId: string; sessionId?: string; root: string; cwd?: string;
  status: "active" | "suspended" | "finalized" | "degraded";
  baselineCreatedAt: string; lastReconciledAt?: string; reconcileRequested: boolean;
  degradedReason?: string; changes: Record<string, ChangeRecordV1>; checks: unknown[];
}
export interface BaselineV1 {
  version: 1; incarnationId: string; sessionId?: string; root: string; cwd?: string;
  createdAt: string; kind: "git" | "manifest"; status?: PorcelainStatus; hashes: Record<string, string>;
}

const CHANGE_BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".avif",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".jar",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".mp3", ".mp4", ".avi", ".mov", ".webm", ".ogg", ".flac",
  ".sqlite", ".db", ".lock",
]);
const CHANGE_MAX_SIZE = 1_048_576;
const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 128) || "unknown";

export function fingerprint(abs: string): string | null {
  // O_NOFOLLOW: a symlink final component fails to open atomically (no
  // lstat-then-read TOCTOU); the fd is what we hash. Mirror of change/eligible.ts.
  let fd: number | undefined;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    return crypto.createHash("sha1").update(fs.readFileSync(fd)).digest("hex");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}
export function isEligiblePath(root: string, rel: string, extraSecretGlobs: string[], excludeDirs: string[]): boolean {
  if (!rel) return false;
  const posix = rel.split(path.sep).join("/");
  if (posix.startsWith("../") || posix === ".." || path.isAbsolute(posix)) return false;
  if (posix === ".packmind" || posix.startsWith(".packmind/")) return false;
  if (posix === ".git" || posix.startsWith(".git/")) return false;
  const segments = posix.split("/");
  const excluded = new Set(excludeDirs);
  if (segments.slice(0, -1).some((s) => excluded.has(s))) return false;
  const base = segments[segments.length - 1];
  if (CHANGE_BINARY_EXT.has(path.extname(base).toLowerCase())) return false;
  if (looksSecret(base, extraSecretGlobs, posix)) return false;
  // Symlink-aware confinement: reject a path whose real location escapes root.
  if (confineToRoot(root, rel) === null) return false;
  try {
    const st = fs.statSync(path.join(root, rel));
    if (st.isFile() && st.size > CHANGE_MAX_SIZE) return false;
  } catch {
    /* absent (a delete): still eligible */
  }
  return true;
}

export function parsePorcelainV2(zOutput: string): PorcelainStatus {
  const fields = zOutput.split("\0");
  const changed: PorcelainEntry[] = [];
  const renames: Array<{ from: string; to: string }> = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f) continue;
    const type = f[0];
    if (type === "1") {
      const parts = f.split(" ");
      const p = parts.slice(8).join(" ");
      if (p) changed.push({ path: p, xy: parts[1] ?? "" });
    } else if (type === "2") {
      const parts = f.split(" ");
      const to = parts.slice(9).join(" ");
      const from = fields[++i] ?? "";
      if (to && from) renames.push({ from, to });
      else if (to) changed.push({ path: to, xy: parts[1] ?? "" });
    } else if (type === "?") {
      const p = f.slice(2);
      if (p) changed.push({ path: p, xy: "??" });
    } else if (type === "u") {
      const parts = f.split(" ");
      const p = parts.slice(10).join(" ");
      if (p) changed.push({ path: p, xy: parts[1] ?? "" });
    }
  }
  return { changed, renames };
}
export function isGitRepo(root: string): boolean {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "true";
  } catch {
    return false;
  }
}
export function gitStatus(root: string): PorcelainStatus | null {
  try {
    const out = execFileSync("git", ["-C", root, "status", "--porcelain=v2", "--find-renames", "--untracked-files=all", "-z"], {
      encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    return parsePorcelainV2(out);
  } catch {
    return null;
  }
}

export function computeNetChanges(baseline: Snapshot, current: Snapshot): NetChange[] {
  const out: NetChange[] = [];
  const handled = new Set<string>();
  for (const { from, to } of current.renames ?? []) {
    const fromInBaseline = baseline.hashes[from] !== undefined;
    const toNow = current.hashes[to] !== undefined;
    if (fromInBaseline && toNow) {
      out.push({ path: to, kind: "rename", previousPath: from });
      handled.add(from);
      handled.add(to);
    }
  }
  for (const [rel, hash] of Object.entries(current.hashes)) {
    if (handled.has(rel)) continue;
    const b = baseline.hashes[rel];
    if (b === undefined) out.push({ path: rel, kind: "add" });
    else if (b !== hash) out.push({ path: rel, kind: "modify" });
  }
  for (const rel of Object.keys(baseline.hashes)) {
    if (handled.has(rel)) continue;
    if (current.hashes[rel] === undefined) out.push({ path: rel, kind: "delete" });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
function kindFromXy(xy: string): ChangeKind {
  if (xy.includes("D")) return "delete";
  if (xy === "??" || xy.includes("A")) return "add";
  return "modify";
}
export function reconcileGit(baseline: GitBaseline, current: GitCurrent): NetChange[] {
  const out: NetChange[] = [];
  const handled = new Set<string>();
  const baselinePaths = new Set<string>();
  for (const e of baseline.status.changed) baselinePaths.add(e.path);
  for (const r of baseline.status.renames) { baselinePaths.add(r.from); baselinePaths.add(r.to); }
  const baselineRenames = new Set(baseline.status.renames.map((r) => `${r.from}\0${r.to}`));
  for (const { from, to } of current.status.renames) {
    if (baselineRenames.has(`${from}\0${to}`)) { handled.add(from); handled.add(to); continue; }
    out.push({ path: to, kind: "rename", previousPath: from });
    handled.add(from); handled.add(to);
  }
  for (const { path: rel, xy } of current.status.changed) {
    if (handled.has(rel)) continue;
    const wasDirty = baselinePaths.has(rel) || baseline.hashes[rel] !== undefined;
    if (!wasDirty) { out.push({ path: rel, kind: kindFromXy(xy) }); continue; }
    const baseHash = baseline.hashes[rel];
    const curHash = current.hashes[rel];
    if (baseHash !== undefined && curHash === undefined) out.push({ path: rel, kind: "delete" });
    else if (baseHash !== undefined && curHash !== undefined && baseHash !== curHash) out.push({ path: rel, kind: "modify" });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
export function recallPathsForChange(change: { kind: ChangeKind; path: string; previousPath?: string }): string[] {
  if (change.kind === "rename" && change.previousPath) return [change.previousPath, change.path];
  return [change.path];
}

// --- change-set + baseline store (mirror of src/change/{store,baseline}.ts) --
function changeSetPath(incarnationId: string): string {
  return brainPath("state", "change-sets", `${safeId(incarnationId)}.json`);
}
function baselinePath(incarnationId: string): string {
  return brainPath("state", "change-baselines", `${safeId(incarnationId)}.json`);
}
export function emptyChangeSet(meta: { incarnationId: string; sessionId?: string; root: string; cwd?: string; baselineCreatedAt: string; degradedReason?: string }): ChangeSetV1 {
  return {
    version: 1, incarnationId: meta.incarnationId, sessionId: meta.sessionId, root: meta.root, cwd: meta.cwd,
    status: meta.degradedReason ? "degraded" : "active", baselineCreatedAt: meta.baselineCreatedAt,
    reconcileRequested: false, degradedReason: meta.degradedReason, changes: {}, checks: [],
  };
}
export function recordCandidate(cs: ChangeSetV1, change: NetChange, source: ChangeSource, at: string, suspectedTools?: string[]): void {
  const existing = cs.changes[change.path];
  if (existing) {
    existing.kind = change.kind;
    if (change.previousPath) existing.previousPath = change.previousPath;
    existing.lastSeenAt = at;
    if (!existing.sources.includes(source)) existing.sources.push(source);
    if (suspectedTools?.length) existing.suspectedTools = Array.from(new Set([...(existing.suspectedTools ?? []), ...suspectedTools]));
    existing.map = "pending";
    existing.recall = "pending";
  } else {
    cs.changes[change.path] = {
      path: change.path, kind: change.kind, previousPath: change.previousPath,
      firstSeenAt: at, lastSeenAt: at, sources: [source],
      suspectedTools: suspectedTools?.length ? suspectedTools : undefined, map: "pending", recall: "pending",
    };
  }
}
export function reconcileInto(cs: ChangeSetV1, net: NetChange[], at: string): void {
  const present = new Set(net.map((n) => n.path));
  for (const p of Object.keys(cs.changes)) if (!present.has(p)) delete cs.changes[p];
  for (const n of net) {
    const existing = cs.changes[n.path];
    if (existing) {
      const kindChanged = existing.kind !== n.kind || existing.previousPath !== n.previousPath;
      existing.kind = n.kind; existing.previousPath = n.previousPath; existing.lastSeenAt = at;
      if (!existing.sources.includes("reconcile")) existing.sources.push("reconcile");
      if (kindChanged) { existing.map = "pending"; existing.recall = "pending"; }
    } else {
      cs.changes[n.path] = {
        path: n.path, kind: n.kind, previousPath: n.previousPath,
        firstSeenAt: at, lastSeenAt: at, sources: ["reconcile"], map: "pending", recall: "pending",
      };
    }
  }
  cs.lastReconciledAt = at;
  cs.reconcileRequested = false;
}
export function readChangeSet(incarnationId: string): ChangeSetV1 | null {
  return readJson<ChangeSetV1 | null>(changeSetPath(incarnationId), null);
}
export function updateChangeSet(incarnationId: string, fallback: ChangeSetV1, fn: (cs: ChangeSetV1) => void): void {
  updateJson<ChangeSetV1>(changeSetPath(incarnationId), fallback, (cs) => { fn(cs); return cs; });
}
export function readBaseline(incarnationId: string): BaselineV1 | null {
  return readJson<BaselineV1 | null>(baselinePath(incarnationId), null);
}
export function writeBaseline(b: BaselineV1): void {
  writeJson(baselinePath(b.incarnationId), b);
}
/** Create a git baseline in-hook (non-git manifest baselines are made by the CLI). */
export function createBaselineGit(root: string, meta: { incarnationId: string; sessionId?: string; cwd?: string }, extraSecretGlobs: string[], excludeDirs: string[]): BaselineV1 {
  const status = gitStatus(root) ?? { changed: [], renames: [] };
  const hashes: Record<string, string> = {};
  const paths = new Set<string>();
  for (const e of status.changed) paths.add(e.path);
  for (const r of status.renames) { paths.add(r.from); paths.add(r.to); }
  for (const rel of paths) {
    if (!isEligiblePath(root, rel, extraSecretGlobs, excludeDirs)) continue;
    const fp = fingerprint(path.join(root, rel));
    if (fp) hashes[rel] = fp;
  }
  return { version: 1, incarnationId: meta.incarnationId, sessionId: meta.sessionId, root, cwd: meta.cwd, createdAt: new Date().toISOString(), kind: "git", status, hashes };
}
/** Bounded zero-dep eligible-file walk (mirror of change/eligible.ts eligibleWalk). */
export function eligibleWalk(root: string, extraSecretGlobs: string[], excludeDirs: string[], maxFiles: number): string[] {
  const max = maxFiles || 4000;
  const excluded = new Set(excludeDirs);
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (out.length >= max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === ".packmind" || excluded.has(e.name)) continue;
        walk(abs);
      } else if (e.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        if (isEligiblePath(root, rel, extraSecretGlobs, excludeDirs)) out.push(rel);
      }
    }
  };
  walk(root);
  return out;
}
/** Create a non-git manifest baseline in-hook (bounded eligible-file fingerprints). */
export function createBaselineManifest(root: string, meta: { incarnationId: string; sessionId?: string; cwd?: string }, extraSecretGlobs: string[], excludeDirs: string[], maxFiles: number): BaselineV1 {
  const hashes: Record<string, string> = {};
  for (const rel of eligibleWalk(root, extraSecretGlobs, excludeDirs, maxFiles)) {
    const fp = fingerprint(path.join(root, rel));
    if (fp) hashes[rel] = fp;
  }
  return { version: 1, incarnationId: meta.incarnationId, sessionId: meta.sessionId, root, cwd: meta.cwd, createdAt: new Date().toISOString(), kind: "manifest", hashes };
}
/** Git-only reconcile in-hook: returns net changes filtered by eligibility, or
 * null if the baseline isn't a git baseline (defer to the CLI for manifests). */
export function reconcileGitSession(root: string, baseline: BaselineV1, extraSecretGlobs: string[], excludeDirs: string[]): NetChange[] | null {
  if (baseline.kind !== "git") return null;
  const current = gitStatus(root) ?? { changed: [], renames: [] };
  const overlap: Record<string, string> = {};
  for (const rel of Object.keys(baseline.hashes)) {
    const fp = fingerprint(path.join(root, rel));
    if (fp) overlap[rel] = fp;
  }
  const net = reconcileGit({ status: baseline.status ?? { changed: [], renames: [] }, hashes: baseline.hashes }, { status: current, hashes: overlap });
  // Transform renames that cross the eligibility boundary (mirror of baseline.ts).
  return net.flatMap((c): NetChange[] => {
    if (c.kind === "rename") {
      const fromOk = c.previousPath ? isEligiblePath(root, c.previousPath, extraSecretGlobs, excludeDirs) : false;
      const toOk = isEligiblePath(root, c.path, extraSecretGlobs, excludeDirs);
      if (fromOk && toOk) return [c];
      if (fromOk) return [{ path: c.previousPath!, kind: "delete" }];
      if (toOk) return [{ path: c.path, kind: "add" }];
      return [];
    }
    return isEligiblePath(root, c.path, extraSecretGlobs, excludeDirs) ? [c] : [];
  });
}

function changeSetFallback(root: string, session: Session): ChangeSetV1 {
  return emptyChangeSet({
    incarnationId: session.id, sessionId: session.sessionId, root, cwd: session.cwd,
    baselineCreatedAt: session.started,
  });
}
/** Record an immediate single-path change candidate and flag a reconcile. */
export function recordChangeCandidate(root: string, session: Session, change: NetChange, source: ChangeSource, at: string, tools?: string[]): void {
  updateChangeSet(session.id, changeSetFallback(root, session), (cs) => {
    recordCandidate(cs, change, source, at, tools);
    cs.reconcileRequested = true;
  });
}
/** Flag that a reconcile is needed (e.g. after a Bash/MCP batch). */
export function requestReconcile(root: string, session: Session): void {
  updateChangeSet(session.id, changeSetFallback(root, session), (cs) => {
    cs.reconcileRequested = true;
  });
}
/**
 * Authoritative reconcile for git projects: diff the baseline, fold the net set
 * into the change set, then apply map/recall for each change idempotently, and
 * persist the per-change map/recall states. Returns the synced change set, or
 * the current one unchanged for non-git/missing baselines (deferred to the CLI).
 * Map/recall work runs OUTSIDE the change-set lock to avoid nested-lock deadlock.
 */
export function reconcileAndSync(root: string, session: Session, cfg: HookConfig): ChangeSetV1 | null {
  const baseline = readBaseline(session.id);
  if (!baseline || baseline.kind !== "git") return readChangeSet(session.id);
  const net = reconcileGitSession(root, baseline, cfg.extraSecretGlobs, cfg.excludeDirs);
  if (net === null) return readChangeSet(session.id);
  const at = new Date().toISOString();

  const before = readChangeSet(session.id);
  const oldPaths = before
    ? Object.values(before.changes).flatMap((r) => (r.previousPath ? [r.path, r.previousPath] : [r.path]))
    : [];

  updateChangeSet(session.id, changeSetFallback(root, session), (cs) => reconcileInto(cs, net, at));

  const states: Record<string, { map: string; recall: string }> = {};
  for (const n of net) {
    let map = "pending";
    try {
      if (n.kind === "delete") {
        removeMapEntry(n.path);
        map = "removed";
      } else {
        if (n.kind === "rename" && n.previousPath) removeMapEntry(n.previousPath);
        const abs = path.join(root, n.path);
        if (fs.existsSync(abs)) {
          upsertMapEntry(n.path, readText(abs, ""), cfg.model, cfg.prices); // map even empty files
          map = "current";
        }
      }
    } catch {
      map = "failed";
    }
    let recall = "pending";
    if (!cfg.recallEnabled) {
      recall = "disabled";
    } else {
      try {
        for (const p of recallPathsForChange(n)) enqueueRecall(p);
        recall = n.kind === "delete" ? "removed" : "queued";
      } catch {
        recall = "failed";
      }
    }
    states[n.path] = { map, recall };
  }

  // Repair paths that LEFT the net (reverted to baseline): sync map/recall to the
  // current filesystem state so an add-then-delete doesn't leave a stale map
  // entry and a delete-then-restore doesn't leave the entry removed.
  const netPaths = new Set(net.map((n) => n.path));
  for (const p of oldPaths) {
    if (netPaths.has(p)) continue;
    try {
      // Never read an ineligible departed path (secret/binary/etc.); just drop it.
      if (fs.existsSync(path.join(root, p)) && isEligiblePath(root, p, cfg.extraSecretGlobs, cfg.excludeDirs)) {
        upsertMapEntry(p, readText(path.join(root, p), ""), cfg.model, cfg.prices);
      } else {
        removeMapEntry(p);
      }
    } catch {
      /* best effort */
    }
    if (cfg.recallEnabled) {
      try {
        enqueueRecall(p);
      } catch {
        /* best effort */
      }
    }
  }

  let result: ChangeSetV1 | null = null;
  updateChangeSet(session.id, changeSetFallback(root, session), (cs) => {
    for (const [p, s] of Object.entries(states)) {
      if (cs.changes[p]) {
        cs.changes[p].map = s.map;
        cs.changes[p].recall = s.recall;
      }
    }
    result = cs;
  });
  return result;
}
/** Unique net changed paths (canonical for practice checks / handoff). */
export function changedPaths(cs: ChangeSetV1 | null): string[] {
  if (!cs) return [];
  return Object.values(cs.changes).map((c) => c.path).sort();
}
