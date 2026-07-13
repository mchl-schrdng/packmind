# PackMind

Rate-limit resume and committed team memory for Claude Code, delivered as four
lifecycle hooks plus an MCP server. Published to npm as `packmind`
(Apache-2.0).

## Stack
- Node >=20, TypeScript, **ESM**. Package manager: **pnpm**.
- Tests: Vitest. No runtime framework; the CLI is plain `commander`.
- Runtime deps: `@modelcontextprotocol/sdk`, `chalk`, `commander`. Nothing
  optional, no postinstall scripts.

## Commands
- `pnpm build` compiles twice: `tsc` (ESM lib to `dist/`) **and**
  `tsc -p tsconfig.hooks.json` (hooks to CommonJS `dist/hooks/`). Both must pass.
- `pnpm test` runs the Vitest suite. `pnpm test:coverage` adds coverage.
- `pnpm audit --prod --audit-level=high` is what CI gates on.
- Run the built CLI: `node dist/bin/packmind.js <cmd>`.

## Architecture (`src/`)
- `bin/`, `cli/` - entrypoint and one file per command: `init`, `status`,
  `doctor` (with `--fix`), `update`, `resume-cmd`, `mcp-cmd`, plus `registry`,
  `ctx`, `locate`, `seed`.
- `hooks/` - the four standalone lifecycle hooks: `session-start` (inject
  handoff + Never-Do, confirm/drop resume tickets), `prompt-submit` (lexical
  surfacing of past solutions), `pre-write` (guard rules), `stop-failure`
  (record a resume ticket on rate_limit) + `runtime.ts` (see rules below).
- `mcp/` - MCP stdio server (`server.ts`) and the four tool handlers
  (`tools.ts`): `recall` (lexical), `remember`, `record_solution`, `handoff`.
- `state/` - `formats.ts` (CRLF-safe brain-file parsers), `schema.ts` (config +
  deep-merge), `files.ts` (brain paths), `project.ts` (root discovery),
  `resume.ts` (ticket store), `mutations.ts` (knowledge/solutions writes).
- `guard/` - `secrets.ts`, `policy.ts` (rules resolved with dedup by id, local
  rule wins), `path-guard.ts`.
- `adapters/claude-code.ts` - registers hooks + the MCP server into a project
  (`_managedBy` tagging, backup-once, strict parse before overwrite).
- `util/` - `fs-atomic.ts`, `paths.ts`, `platform.ts`.
- `templates/` - files seeded into a consuming project's `.packmind/`.

## Critical conventions (these change how you must edit)
- **Hooks are zero-dependency.** Everything under `src/hooks/` may import ONLY
  Node builtins; they run as standalone scripts copied into users' projects.
- **`runtime.ts` mirrors canonical modules.** Its parsers, secret matcher, and
  resume-ticket store duplicate `state/formats.ts`, `guard/secrets.ts`,
  `guard/policy.ts`, `state/resume.ts`. Edit BOTH copies together;
  `test/runtime-parity.test.ts` fails if they drift.
- **NodeNext imports:** use `.js` specifiers that resolve to `.ts` sources
  (e.g. `import { x } from "./foo.js"`). Vitest maps them back to `.ts`.
- **Tests are hermetic:** `test/setup.ts` sets `PACKMIND_HOME`. Never write to
  the real `~/.packmind` from code that runs in tests.

## Workflow
- Before committing: `pnpm build` and `pnpm test` must be green. Add/extend a
  test for any behavior change.
- **Commit messages: no AI/co-author trailers.** Keep history clean and minimal.
- Do not commit dogfooding artifacts (`.packmind/`, `.mcp.json`); they are
  gitignored.
- **Releases publish to npm.** Bump `package.json`, then create a GitHub Release
  `vX.Y.Z`; the `release` workflow runs `npm publish`. CI must be green first.

## Provenance
This is original, clean-room work under Apache-2.0. Do not introduce references
to other projects' names, file formats, or terminology.
