import { readJsonOr, writeJson } from "../util/fs-atomic.js";

export interface VectorRecord {
  id: string;
  source: string;
  kind: string;
  text: string;
  vector: number[];
}

interface VectorFile {
  version: number;
  model: string;
  records: VectorRecord[];
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** A flat-file vector index. Small projects fit comfortably in memory. */
export class VectorStore {
  private data: VectorFile;

  constructor(private readonly file: string, model = "unknown") {
    this.data = readJsonOr<VectorFile>(file, { version: 1, model, records: [] });
  }

  /** Replace all records whose source matches one being upserted. */
  upsertBySource(records: VectorRecord[]): void {
    const sources = new Set(records.map((r) => r.source));
    this.data.records = this.data.records.filter((r) => !sources.has(r.source));
    this.data.records.push(...records);
  }

  removeSource(source: string): void {
    this.data.records = this.data.records.filter((r) => r.source !== source);
  }

  sources(): Set<string> {
    return new Set(this.data.records.map((r) => r.source));
  }

  search(queryVector: number[], topK: number): Array<VectorRecord & { score: number }> {
    return this.data.records
      .map((r) => ({ ...r, score: cosine(queryVector, r.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  size(): number {
    return this.data.records.length;
  }

  save(): void {
    writeJson(this.file, this.data);
  }
}
