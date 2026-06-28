import * as path from "node:path";

const KNOWN: Record<string, string> = {
  "package.json": "Node package manifest",
  "tsconfig.json": "TypeScript compiler config",
  "Dockerfile": "Container build recipe",
  "docker-compose.yml": "Docker Compose services",
  ".gitignore": "Git ignore rules",
  "Makefile": "Make build targets",
  "README.md": "Project readme",
  "LICENSE": "License text",
  "pyproject.toml": "Python project config",
  "Cargo.toml": "Rust crate manifest",
  "go.mod": "Go module definition",
  "vite.config.ts": "Vite build config",
  "vitest.config.ts": "Vitest test config",
};

const COMMENT = /^\s*(?:\/\/+|#+|--|;|\*)\s?(.+)$/;

/**
 * Derive a one-line description of a file from its first 8KB. Original
 * heuristic: known names first, then a leading doc/comment, a JSON description,
 * or the first declared symbol. Returns "" when nothing meaningful is found.
 */
export function describeFile(filePath: string, content: string): string {
  const base = path.basename(filePath);
  if (KNOWN[base]) return KNOWN[base];

  const head = content.slice(0, 8192);
  const ext = path.extname(base).toLowerCase();

  if (ext === ".md" || ext === ".mdx") {
    const h = head.match(/^#{1,3}\s+(.+)$/m);
    if (h) return cap(h[1]);
  }
  if (ext === ".json") {
    try {
      const j = JSON.parse(content);
      if (typeof j.description === "string" && j.description) return cap(j.description);
      if (typeof j.name === "string" && j.name) return cap(String(j.name));
    } catch {
      /* not valid JSON */
    }
  }

  for (const raw of head.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const c = line.match(COMMENT);
    if (c && c[1].trim().length > 3 && !/^[=*-]+$/.test(c[1].trim())) return cap(c[1]);
    break; // only consider the very first non-blank line as a header comment
  }

  const sym = head.match(
    /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|interface|type|def|struct|enum|fn)\s+([A-Za-z_$][\w$]*)/,
  );
  if (sym) return cap(`Defines ${sym[1]}`);

  return "";
}

function cap(s: string, max = 90): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}
