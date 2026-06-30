# Contributing to PackMind

Thanks for your interest in PackMind — a second brain for Claude Code. This guide
covers how to get set up, the conventions that keep the codebase healthy, and how
to get a change merged.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Report a bug** or request a feature via the [issue tracker](https://github.com/mchl-schrdng/packmind/issues).
- **Improve docs** — the README, this guide, or `src/templates/PACKMIND.md`.
- **Send a pull request** — fixes, features, tests. For anything large, please
  open an issue first so we can agree on the approach before you build it.

## Requirements

- **Node.js 20+**
- **pnpm** (the project's package manager)

## Getting started

```bash
git clone https://github.com/mchl-schrdng/packmind
cd packmind
pnpm install
pnpm build      # compiles the lib and the hooks (see below)
pnpm test       # Vitest suite — should be green before you start
```

Run the built CLI locally with:

```bash
node dist/bin/packmind.js <command>
```

## The two-step build

`pnpm build` runs **two** TypeScript compilations and both must pass:

1. `tsc` — the ESM library and CLI → `dist/`.
2. `tsc -p tsconfig.hooks.json` — the lifecycle hooks → CommonJS in `dist/hooks/`.

The hooks are compiled separately because they are copied into consuming projects
and run as standalone scripts.

## Tests

- `pnpm test` — run the Vitest suite once.
- `pnpm test:watch` — watch mode while developing.
- `pnpm test:coverage` — coverage report.

**Add or extend a test for any behavior change.** Tests are hermetic:
`test/setup.ts` points `PACKMIND_HOME` at a throwaway directory, so nothing should
ever read from or write to the real `~/.packmind` during a test.

## Conventions that change how you must edit

These are not style preferences — getting them wrong breaks the build or the
shipped hooks:

- **Hooks are zero-dependency.** Everything under `src/hooks/` may import **only
  Node built-ins**. They run as standalone scripts in users' projects, so they
  cannot depend on `node_modules`.
- **`runtime.ts` mirrors canonical modules.** `src/hooks/runtime.ts` deliberately
  duplicates the parsers, secret matcher, pricing, and token estimator from
  `state/formats.ts`, `guard/secrets.ts`, `cost/pricing.ts`, and
  `cost/estimator.ts`. **Edit both copies together** —
  `test/runtime-parity.test.ts` fails if they drift.
- **NodeNext imports.** Use `.js` specifiers that resolve to the `.ts` source
  (e.g. `import { x } from "./foo.js"`). Vitest maps them back to `.ts`.
- **Pricing defaults are approximate** and overridable via `cost.prices`. Don't
  present them as authoritative anywhere in code or docs.
- **Don't commit dogfooding artifacts.** `.packmind/`, `.mcp.json`, and `.claude/`
  are gitignored. (`CLAUDE.md` *is* committed — it's the hand-written dev guide.)

## Provenance

PackMind is original, clean-room work under Apache-2.0. **Do not introduce
references to other projects' names, file formats, or terminology.** Contributions
must be your own work, or clearly licensed in a way compatible with Apache-2.0.

## Commit & PR guidelines

- Keep history clean and minimal. **Do not add AI assistant or co-author trailers**
  to commit messages.
- Write a clear, imperative commit subject (e.g. `cost: reconcile exact counts on
  scan`). Explain the *why* in the body when it isn't obvious.
- Before opening a PR, make sure `pnpm build` **and** `pnpm test` are green.
- Keep each PR focused on a single concern; unrelated changes belong in separate
  PRs.
- CI must pass: build/test on Node 20 and 22, the dependency audit
  (`pnpm audit --prod --audit-level=high`), and CodeQL.

## Security

Found a vulnerability? Please **don't** open a public issue with exploit details —
see the reporting guidance in the [README's Security section](README.md#security)
and contact the maintainer privately.

## Releases

Releases are handled by the maintainer: bump the version in `package.json`, create
a GitHub Release `vX.Y.Z`, and the release workflow publishes to npm. CI must be
green first.

## License

By contributing, you agree that your contributions will be licensed under the
project's [Apache-2.0](LICENSE) license.
