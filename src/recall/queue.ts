import { readJsonOr, updateJson } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";

/**
 * The index queue records source paths the hooks touched so the indexer can
 * (re)embed them lazily. Hooks have no heavy dependencies, so they only enqueue;
 * `packmind index` and the MCP server drain the queue.
 */
export function enqueue(projectRoot: string, relPath: string): void {
  // Read-modify-write under one lock so concurrent enqueues can't overwrite each
  // other (a plain read-then-write loses updates).
  updateJson<string[]>(brain(projectRoot).queue, [], (q) =>
    q.includes(relPath) ? q : [...q, relPath],
  );
}

export function peekQueue(projectRoot: string): string[] {
  return readJsonOr<string[]>(brain(projectRoot).queue, []);
}

/**
 * Acknowledge processed paths by removing exactly them from the queue. Anything
 * enqueued while the caller was working (not in `processed`) is preserved, so a
 * peek -> build -> save -> ack cycle never drops concurrently-queued work.
 */
export function ackQueue(projectRoot: string, processed: string[]): void {
  const done = new Set(processed);
  updateJson<string[]>(brain(projectRoot).queue, [], (q) => q.filter((p) => !done.has(p)));
}
