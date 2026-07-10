import * as fs from "node:fs";
import * as path from "node:path";
import { walkProject } from "../state/walk.js";
import { brain } from "../state/files.js";
import { chunkText, type Chunk } from "./chunker.js";
import { VectorStore, type VectorRecord } from "./store.js";
import { peekQueue, ackQueue } from "./queue.js";
import type { Embedder } from "./embedder.js";
import type { Config } from "../state/schema.js";

/** Brain files that are worth embedding as searchable knowledge. */
const BRAIN_SOURCES: Array<{ file: string; kind: string }> = [
  { file: "knowledge.md", kind: "knowledge" },
  { file: "journal.md", kind: "journal" },
  { file: "solutions.json", kind: "solution" },
  { file: "handoff.md", kind: "handoff" },
];

function collectChunks(projectRoot: string, config: Config, sources: string[] | null): Chunk[] {
  const chunks: Chunk[] = [];
  const want = sources ? new Set(sources) : null;

  for (const { file, kind } of BRAIN_SOURCES) {
    const rel = `.packmind/${file}`;
    if (want && !want.has(rel)) continue;
    try {
      const text = fs.readFileSync(path.join(projectRoot, ".packmind", file), "utf8");
      chunks.push(...chunkText(text, rel, kind, config.recall.chunkChars));
    } catch {
      /* missing brain file */
    }
  }

  for (const { abs, rel } of walkProject(projectRoot, config)) {
    if (want && !want.has(rel)) continue;
    try {
      const text = fs.readFileSync(abs, "utf8");
      chunks.push(...chunkText(text, rel, "code", config.recall.chunkChars));
    } catch {
      /* unreadable */
    }
  }
  return chunks;
}

async function embedChunks(embedder: Embedder, chunks: Chunk[]): Promise<VectorRecord[]> {
  if (chunks.length === 0) return [];
  const vectors = await embedder.embed(chunks.map((c) => c.text));
  return chunks.map((c, i) => ({
    id: `${c.source}#${i}`,
    source: c.source,
    kind: c.kind,
    text: c.text,
    vector: vectors[i],
  }));
}

/** Full (re)index of the project into the vector store. */
export async function buildIndex(
  projectRoot: string,
  config: Config,
  embedder: Embedder,
): Promise<number> {
  const chunks = collectChunks(projectRoot, config, null);
  const records = await embedChunks(embedder, chunks);
  const store = new VectorStore(brain(projectRoot).vectors, config.recall.embedModel);
  // Group by source so upsertBySource replaces cleanly.
  const bySource = new Set(records.map((r) => r.source));
  for (const s of store.sources()) if (!bySource.has(s)) store.removeSource(s);
  store.upsertBySource(records);
  store.save();
  return store.size();
}

/** Incrementally embed whatever the hooks queued; drop deleted sources. */
export async function refreshFromQueue(
  projectRoot: string,
  config: Config,
  embedder: Embedder,
): Promise<number> {
  // Peek (don't drain): the queue is only acknowledged AFTER a successful save,
  // so a failed embed (model download/load error) leaves the work item on disk
  // for a later retry instead of silently losing it. Each entry carries the
  // generation observed here; ackQueue only removes a path still at that
  // generation, so a re-enqueue during embedding survives for reprocessing.
  const entries = peekQueue(projectRoot);
  if (!entries.length) return 0;
  const paths = entries.map((e) => e.path);

  // Embed first; if this throws, we've mutated nothing (store untouched, queue
  // intact).
  const present = paths.filter((rel) => fs.existsSync(path.join(projectRoot, rel)));
  const chunks = collectChunks(projectRoot, config, present);
  const records = await embedChunks(embedder, chunks);

  const store = new VectorStore(brain(projectRoot).vectors, config.recall.embedModel);
  // Clear every queued source's old embeddings. Whatever still has content is
  // re-added below; a deleted OR emptied file (which yields no chunks) therefore
  // stays gone instead of lingering in recall results.
  for (const rel of paths) store.removeSource(rel);
  store.upsertBySource(records);
  store.save();

  // Only now acknowledge the work, removing exactly what we processed (and only
  // at the generation we processed) and preserving anything the hooks enqueued
  // while we were embedding.
  ackQueue(projectRoot, entries);
  return records.length;
}

export interface RecallHit {
  source: string;
  kind: string;
  text: string;
  score: number;
}

/** Records currently in the on-disk vector index (0 means it isn't built yet). */
export function indexSize(projectRoot: string, config: Config): number {
  return new VectorStore(brain(projectRoot).vectors, config.recall.embedModel).size();
}

export async function recall(
  projectRoot: string,
  config: Config,
  embedder: Embedder,
  query: string,
): Promise<RecallHit[]> {
  await refreshFromQueue(projectRoot, config, embedder);
  const store = new VectorStore(brain(projectRoot).vectors, config.recall.embedModel);
  if (store.size() === 0) return [];
  const [qv] = await embedder.embed([query]);
  return store
    .search(qv, config.recall.topK)
    .map((r) => ({ source: r.source, kind: r.kind, text: r.text, score: r.score }));
}
