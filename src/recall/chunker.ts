export interface Chunk {
  source: string;
  kind: string;
  text: string;
}

/**
 * Split text into windows of roughly `size` characters, breaking on line
 * boundaries where possible so chunks stay semantically coherent.
 */
export function chunkText(text: string, source: string, kind: string, size = 1200): Chunk[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= size) return [{ source, kind, text: clean }];

  const chunks: Chunk[] = [];
  const lines = clean.split(/\r?\n/);
  let buf = "";
  for (const line of lines) {
    if (buf.length + line.length + 1 > size && buf) {
      chunks.push({ source, kind, text: buf.trim() });
      buf = "";
    }
    buf += line + "\n";
  }
  if (buf.trim()) chunks.push({ source, kind, text: buf.trim() });
  return chunks;
}
