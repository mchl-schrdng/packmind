import { readJsonOr, updateJson } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";

/**
 * The index queue records source paths the hooks touched so the indexer can
 * (re)embed them lazily. Hooks have no heavy dependencies, so they only enqueue;
 * `packmind index` and the MCP server drain the queue.
 *
 * On disk the queue is a map of `path -> generation`. The generation is bumped
 * on every enqueue, which is what closes a same-path race: if a file changes and
 * re-enqueues WHILE the indexer is embedding an older snapshot, the bump makes
 * the second marker survive the ack (the ack only deletes a path whose
 * generation still matches the one it processed). A legacy `string[]` queue is
 * migrated in place to generation 1 on first read/write.
 */

/** One pending path plus the generation observed when it was peeked. */
export interface QueueEntry {
  path: string;
  gen: number;
}

type QueueMap = Record<string, number>;

/**
 * Normalize any on-disk queue value into a `path -> generation` map. A legacy
 * `string[]` queue migrates each entry to generation 1; a well-formed object is
 * kept (dropping non-numeric values); anything else becomes an empty map.
 */
function normalize(raw: unknown): QueueMap {
  if (Array.isArray(raw)) {
    const m: QueueMap = {};
    for (const p of raw) if (typeof p === "string") m[p] = 1;
    return m;
  }
  if (raw && typeof raw === "object") {
    const m: QueueMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) m[k] = v;
    }
    return m;
  }
  return {};
}

/** Read the queue as a normalized `path -> generation` map (migrating legacy). */
export function readQueue(projectRoot: string): QueueMap {
  return normalize(readJsonOr<unknown>(brain(projectRoot).queue, {}));
}

export function enqueue(projectRoot: string, relPath: string): void {
  // Read-modify-write under one lock so concurrent enqueues can't overwrite each
  // other. ALWAYS bump the generation (never dedup): the bump is exactly what
  // lets a re-enqueue during embedding survive the indexer's ack.
  updateJson<unknown>(brain(projectRoot).queue, {}, (raw) => {
    const m = normalize(raw);
    m[relPath] = (m[relPath] ?? 0) + 1;
    return m;
  });
}

export function peekQueue(projectRoot: string): QueueEntry[] {
  return Object.entries(readQueue(projectRoot)).map(([path, gen]) => ({ path, gen }));
}

/**
 * Acknowledge processed entries by removing exactly them from the queue - but
 * only if the on-disk generation still matches what was processed. Anything
 * enqueued while the caller was working bumped the generation, so it stays for
 * reprocessing; a peek -> build -> save -> ack cycle never drops newer content.
 */
export function ackQueue(projectRoot: string, processed: QueueEntry[]): void {
  updateJson<unknown>(brain(projectRoot).queue, {}, (raw) => {
    const m = normalize(raw);
    for (const { path, gen } of processed) {
      if (m[path] === gen) delete m[path];
    }
    return m;
  });
}
