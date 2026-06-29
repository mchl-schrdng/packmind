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
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      // Measure the library code we actually ship/run. The standalone hook
      // bundle (src/hooks/*, except its tested runtime) runs out-of-process and
      // isn't imported by the suite, so it would only dilute the number.
      include: ["src/**/*.ts"],
      exclude: [
        "src/bin/**",
        "src/hooks/session-start.ts",
        "src/hooks/prompt-submit.ts",
        "src/hooks/pre-read.ts",
        "src/hooks/post-read.ts",
        "src/hooks/pre-write.ts",
        "src/hooks/post-write.ts",
        "src/hooks/stop.ts",
        "src/dashboard/**",
        "src/mcp/server.ts",
      ],
    },
  },
});
