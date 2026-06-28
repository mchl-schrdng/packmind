import { userRoot } from "../util/platform.js";

/** Anything that can turn text into vectors (real model or a test stub). */
export interface Embedder {
  dimensions(): number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Local, offline embedder backed by transformers.js (WASM). The model is
 * downloaded once and cached under ~/.packmind/models — no API key, no network
 * after the first run, nothing leaves the machine.
 */
export class LocalEmbedder implements Embedder {
  private pipe: unknown = null;
  private dims = 384;

  constructor(private readonly model = "Xenova/all-MiniLM-L6-v2") {}

  dimensions(): number {
    return this.dims;
  }

  private async ensure(): Promise<any> {
    if (this.pipe) return this.pipe;
    let mod: any;
    try {
      // Resolved at runtime only — the package is an OPTIONAL dependency, so a
      // non-literal specifier keeps `tsc` from requiring it at compile time
      // (it isn't installed in CI's --no-optional build).
      const pkg = "@xenova/transformers";
      mod = await import(pkg);
    } catch {
      throw new Error(
        "Semantic recall needs the optional '@xenova/transformers' package. Install it with:\n" +
          "  npm install -g @xenova/transformers\n" +
          "(or set recall.enabled = false in .packmind/config.json to disable recall).",
      );
    }
    mod.env.cacheDir = `${userRoot()}/models`;
    mod.env.allowLocalModels = true;
    this.pipe = await mod.pipeline("feature-extraction", this.model);
    return this.pipe;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const pipe = await this.ensure();
    const out: number[][] = [];
    for (const text of texts) {
      const tensor: any = await pipe(text, { pooling: "mean", normalize: true });
      const vec = Array.from(tensor.data as Float32Array);
      this.dims = vec.length;
      out.push(vec);
    }
    return out;
  }
}
