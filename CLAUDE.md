# PackMind

A second brain for Claude Code: project memory, real token & cost accounting,
local semantic recall, and active guardrails — delivered as lifecycle hooks plus
an MCP server. Published to npm as `packmind` (Apache-2.0).

## Stack
- Node ≥20, TypeScript, **ESM**. Package manager: **pnpm**.
- Tests: Vitest. No runtime framework — the CLI is plain `commander`.
- Runtime deps: `@modelcontextprotocol/sdk`, `chalk`, `commander`, `ignore`.
  Optional: `@xenova/transformers` (local embeddings; recall only).

## Commands
- `pnpm build` — compiles twice: `tsc` (ESM lib → `dist/`) **and**
  `tsc -p tsconfig.hooks.json` (hooks → CommonJS `dist/hooks/`). Both must pass.
- `pnpm test` — Vitest suite. `pnpm test:coverage` — coverage + report.
- `pnpm audit --prod --audit-level=high` — what CI gates on.
- Run the built CLI: `node dist/bin/packmind.js <cmd>`.

## Architecture (`src/`)
- `bin/`, `cli/` — entrypoint and one file per command (`init`, `scan`, `status`,
  `insights`, `recall-cmd`, `backup-cmd`, `maintain-cmd`, `doctor`, `mcp-cmd`, …).
- `hooks/` — the 7 standalone lifecycle hooks + `runtime.ts` (see rules below).
- `mcp/` — MCP stdio server (`server.ts`) and tool handlers (`tools.ts`).
- `state/` — `formats.ts` (CRLF-safe map/knowledge parsers), `schema.ts` (config
  + deep-merge), `mapper.ts` (the file map), `snapshot.ts` (backup/restore),
  `walk.ts`, `project.ts`.
- `cost/` — `estimator.ts` (local), `exact.ts` (Anthropic count-tokens),
  `pricing.ts`, `ledger.ts`, `insights.ts`.
- `recall/` — local embeddings (`embedder.ts`), vector store, chunker, indexer.
- `guard/` — `secrets.ts`, `path-guard.ts`, `policy.ts`.
- `adapters/claude-code.ts` — registers hooks + the MCP server into a project.
- `dashboard/` — loopback web dashboard (`server.ts` + `templates/dashboard.html`).
- `templates/` — files seeded into a consuming project's `.packmind/`.

## Critical conventions (these change how you must edit)
- **Hooks are zero-dependency.** Everything under `src/hooks/` may import ONLY
  Node builtins — they run as standalone scripts copied into users' projects.
- **`runtime.ts` mirrors canonical modules.** Its parsers, secret matcher,
  pricing and estimator duplicate `state/formats.ts`, `guard/secrets.ts`,
  `cost/pricing.ts`, `cost/estimator.ts`. Edit BOTH copies together;
  `test/runtime-parity.test.ts` fails if they drift.
- **NodeNext imports:** use `.js` specifiers that resolve to `.ts` sources
  (e.g. `import { x } from "./foo.js"`). Vitest maps them back to `.ts`.
- **Tests are hermetic:** `test/setup.ts` sets `PACKMIND_HOME`. Never write to
  the real `~/.packmind` from code that runs in tests.
- **Pricing defaults are approximate** and overridable via `cost.prices` —
  don't present them as authoritative.

## Workflow
- Before committing: `pnpm build` and `pnpm test` must be green. Add/extend a
  test for any behavior change.
- **Commit messages: no AI/co-author trailers.** Keep history clean and minimal.
- Do not commit dogfooding artifacts (`.packmind/`, `.mcp.json`) — they are
  gitignored.
- **Releases publish to npm.** Bump `package.json`, then create a GitHub Release
  `vX.Y.Z`; the `release` workflow runs `npm publish`. CI must be green first.

## Provenance
This is original, clean-room work under Apache-2.0. Do not introduce references to
other projects' names, file formats, or terminology.
