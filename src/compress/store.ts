import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { brain } from "../state/files.js";
import { readJsonOr, writeJson, writeText } from "../util/fs-atomic.js";

// Content-addressed store of large NON-source blobs Claude has shelved. The
// original is kept verbatim on disk and returned by retrieve(); compress() hands
// back a compact, reversible preview so the raw text can leave the context.
const MAX_BLOBS = 50;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const SMALL_BYTES = 4096;
const HEAD_LINES = 12;
const TAIL_LINES = 8;
const MAX_SIGNAL_LINES = 20;
const SIGNAL = /error|warn|fail|exception|traceback|fatal/i;

export interface BlobMeta {
  hash: string;
  bytes: number;
  kind: string;
  createdAt: string;
}

/**
 * Deterministic, reversible compaction: keep the head, tail, and any error/warn
 * lines, and point at the retrieval hash for the rest. Nothing is invented, so a
 * preview never misleads: the full original is always one retrieve() away.
 */
export function compact(content: string, hash: string): string {
  if (content.length <= SMALL_BYTES) return content;
  const marker = (n: number, unit: string) =>
    `... ${n} ${unit} hidden. retrieve("${hash}") for the full original ...`;
  const lines = content.split(/\r?\n/);

  if (lines.length > HEAD_LINES + TAIL_LINES + 5) {
    const head = lines.slice(0, HEAD_LINES);
    const tail = lines.slice(-TAIL_LINES);
    const signal: string[] = [];
    for (let i = HEAD_LINES; i < lines.length - TAIL_LINES && signal.length < MAX_SIGNAL_LINES; i++) {
      if (SIGNAL.test(lines[i])) signal.push(`  ${i + 1}: ${lines[i].trim()}`);
    }
    const out = [...head, marker(lines.length - HEAD_LINES - TAIL_LINES, `of ${lines.length} lines`)];
    if (signal.length) out.push("matched lines:", ...signal);
    out.push(...tail);
    const joined = out.join("\n");
    // If mostly-signal content made the "preview" bigger than the original, fall
    // through to char truncation, which is always shorter.
    if (joined.length < content.length) return joined;
  }

  // Few but very long lines (e.g. minified JSON), or a line-based preview that
  // did not actually shrink: truncate by characters.
  const HEAD_CHARS = 1500;
  const TAIL_CHARS = 800;
  return (
    content.slice(0, HEAD_CHARS) + "\n" +
    marker(content.length - HEAD_CHARS - TAIL_CHARS, "chars") + "\n" +
    content.slice(-TAIL_CHARS)
  );
}

function prune(dir: string, index: BlobMeta[], keepHash: string): void {
  index.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first
  let total = index.reduce((sum, m) => sum + m.bytes, 0);
  let i = 0;
  while (i < index.length && (index.length > MAX_BLOBS || total > MAX_TOTAL_BYTES)) {
    // Never evict the blob we just stored, even if it alone exceeds the cap:
    // reversibility must hold exactly when content is largest.
    if (index[i].hash === keepHash) {
      i++;
      continue;
    }
    total -= index[i].bytes;
    try {
      fs.rmSync(path.join(dir, index[i].hash), { force: true });
    } catch {
      /* already gone */
    }
    index.splice(i, 1);
  }
}

/** Store `content` verbatim and return its hash, size, and a compact preview. */
export function store(projectRoot: string, content: string, kind = "text"): { hash: string; bytes: number; preview: string } {
  const b = brain(projectRoot);
  fs.mkdirSync(b.compressDir, { recursive: true });
  const bytes = Buffer.byteLength(content, "utf8");
  const hash = crypto.createHash("sha256").update(content).digest("hex").slice(0, 12);
  writeText(path.join(b.compressDir, hash), content);

  const index = readJsonOr<BlobMeta[]>(b.compressIndex, []);
  if (!index.some((m) => m.hash === hash)) {
    index.push({ hash, bytes, kind, createdAt: new Date().toISOString() });
  }
  prune(b.compressDir, index, hash);
  writeJson(b.compressIndex, index);

  return { hash, bytes, preview: compact(content, hash) };
}

/** Return the original text for a hash, or null if unknown/pruned. */
export function retrieve(projectRoot: string, hash: string): string | null {
  // Guard against path traversal: a hash is only ever lowercase hex.
  if (!/^[a-f0-9]{1,64}$/.test(hash)) return null;
  try {
    return fs.readFileSync(path.join(brain(projectRoot).compressDir, hash), "utf8");
  } catch {
    return null;
  }
}
