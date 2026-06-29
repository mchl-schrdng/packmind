import * as fs from "node:fs";
import * as path from "node:path";
import { defineConfig } from "vitest/config";

// Sources use `.js` import specifiers that point at `.ts` files (NodeNext style).
// Map them back to `.ts` so Vitest can load the sources directly.
export default defineConfig({
  plugins: [
    {
      name: "js-to-ts",
      enforce: "pre",
      resolveId(source, importer) {
        if (importer && source.endsWith(".js") && (source.startsWith("./") || source.startsWith("../"))) {
          const candidate = path.resolve(path.dirname(importer), source.replace(/\.js$/, ".ts"));
          if (fs.existsSync(candidate)) return candidate;
        }
        return null;
      },
    },
  ],
  test: { include: ["test/**/*.test.ts"], environment: "node", setupFiles: ["test/setup.ts"] },
});
