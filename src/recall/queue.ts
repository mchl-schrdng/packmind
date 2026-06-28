import { readJsonOr, writeJson } from "../util/fs-atomic.js";
import { brain } from "../state/files.js";

/**
 * The index queue records source paths the hooks touched so the indexer can
 * (re)embed them lazily. Hooks have no heavy dependencies, so they only enqueue;
 * `packmind index` and the MCP server drain the queue.
 */
export function enqueue(projectRoot: string, relPath: string): void {
  const q = readJsonOr<string[]>(brain(projectRoot).queue, []);
  if (!q.includes(relPath)) {
    q.push(relPath);
    writeJson(brain(projectRoot).queue, q);
  }
}

export function drainQueue(projectRoot: string): string[] {
  const path = brain(projectRoot).queue;
  const q = readJsonOr<string[]>(path, []);
  if (q.length) writeJson(path, []);
  return q;
}

export function peekQueue(projectRoot: string): string[] {
  return readJsonOr<string[]>(brain(projectRoot).queue, []);
}
