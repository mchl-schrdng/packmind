import * as fs from "node:fs";
import * as path from "node:path";
import { walkProject } from "../state/walk.js";
import { brain } from "../state/files.js";
import { chunkText, type Chunk } from "./chunker.js";
import { VectorStore, type VectorRecord } from "./store.js";
import { drainQueue } from "./queue.js";
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
  const queued = drainQueue(projectRoot);
  if (queued.length === 0) return 0;
  const store = new VectorStore(brain(projectRoot).vectors, config.recall.embedModel);

  const present = queued.filter((rel) => fs.existsSync(path.join(projectRoot, rel)) || rel.startsWith(".packmind/"));
  for (const rel of queued) if (!present.includes(rel)) store.removeSource(rel);

  const chunks = collectChunks(projectRoot, config, present);
  const records = await embedChunks(embedder, chunks);
  store.upsertBySource(records);
  store.save();
  return records.length;
}

export interface RecallHit {
  source: string;
  kind: string;
  text: string;
  score: number;
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
