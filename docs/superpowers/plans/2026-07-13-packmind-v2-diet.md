# PackMind 2.0 Diet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild PackMind as a minimal 2.0.0 that keeps only what the 1.0.0 audit found valuable (rate-limit resume, shared committed memory, secret guard, lifecycle tooling) and deletes everything else, with a rewritten README.

**Architecture:** Subtractive refactor on a new branch `release/v2` cut from `main`. Whole subsystems are deleted with their tests; the surviving modules are slimmed so nothing references the deleted ones; `runtime.ts` shrinks to mirror only the surviving canonical modules; README and CLAUDE.md are rewritten around the new surface.

**Tech Stack:** Node >=20, TypeScript ESM (NodeNext), pnpm, Vitest, commander, @modelcontextprotocol/sdk, chalk. `@xenova/transformers` is REMOVED entirely (no optionalDependencies left). Drop `ignore` from dependencies if nothing imports it after the cut (it was used by `state/walk.ts`).

## Global Constraints

- Branch: `release/v2` cut from `main`. Never commit to `main` directly.
- Version: `2.0.0` in package.json (npm and the git tag `v1.0.0` are immutable; 1.0.0 cannot be reused).
- `pnpm build` (tsc + tsconfig.hooks.json) AND `pnpm test` must be green before every commit.
- Commit messages: conventional, no AI/co-author trailers of any kind.
- Hooks under `src/hooks/` import ONLY Node builtins (they are copied standalone into user projects).
- `src/hooks/runtime.ts` must stay byte-parity with the canonical modules it mirrors; update `test/runtime-parity.test.ts` to pin only the surviving mirrors.
- NodeNext: imports use `.js` specifiers resolving to `.ts` sources.
- Tests hermetic: never touch real `~/.packmind` (test/setup.ts sets PACKMIND_HOME).
- No em dashes and no French strings anywhere in code, docs, or README.
- Do not reference other projects' names or terminology (clean-room provenance).

## Target surface (the whole product after the diet)

- **CLI commands:** `init`, `status`, `doctor [--fix]`, `update`, `resume`, `mcp`. Nothing else.
- **Hooks (4):** `session-start` (inject handoff + knowledge Never-Do + confirm/drop resume ticket), `prompt-submit` (lexical surfacing of past solutions), `pre-write` (secret/policy guard deny-warn), `stop-failure` (record resume ticket on rate_limit).
- **MCP tools (4):** `recall` (lexical search over brain files, NO embeddings), `remember`, `record_solution`, `handoff` (get/set).
- **Brain files (committed):** `.packmind/knowledge.md`, `solutions.json`, `handoff.md`, `policy.json`, `config.json`. No map.md, journal.md, usage.json.
- **Guard:** built-in secret rules + user rules from `policy.json`, resolved WITH dedup by rule id (fixes the doubled `no-secret-files` warning found in the audit).
- **`.mcp.json`:** written by init as `{"command": "npx", "args": ["packmind", "mcp"]}` so local (non-global) installs work (fixes audit bug 2).

## KEEP / CUT inventory (exhaustive)

**KEEP src (slim where noted):**
`bin/packmind.ts` (slim), `cli/{index,registry,ctx,locate,init,seed,status,doctor,update,resume-cmd,mcp-cmd}.ts` (slim; seed keeps only surviving templates), `hooks/{session-start,prompt-submit,pre-write,stop-failure,runtime}.ts` (all slimmed), `mcp/{server,tools}.ts` (slim to 4 tools), `guard/{secrets,policy,path-guard}.ts` (policy loses packs/practices), `state/{files,formats,schema,project,resume,mutations}.ts` (slim), `util/{fs-atomic,paths,platform}.ts`, `adapters/claude-code.ts` (slim to 4 hooks), `templates/{PACKMIND.md,claude-md-snippet.md,config.json,gitignore,gitattributes,handoff.md,knowledge.md,solutions.json,policy.json}` (all rewritten smaller).

**CUT src (delete whole files):**
`change/*` (7 files), `compress/store.ts`, `cost/*` (5), `dashboard/*` (2), `recall/*` (5), `guard/practices.ts`, `state/{debt,describe,maintain,map-mutations,mapper,mutations→prune to knowledge/solutions only,review,session,snapshot,walk}.ts` (delete all except the pruned mutations), `hooks/{file-changed,post-read,post-tool-batch,post-write,pre-read,session-end,stop}.ts`, `cli/{backup-cmd,changes-cmd,dashboard-cmd,debt-cmd,index-cmd,insights-cmd,maintain-cmd,policy-cmd,practice-cmd,recall-cmd,scan,solutions-cmd,upgrade-cmd}.ts`, `templates/{dashboard.html,map.md,journal.md,usage.json,identity.md,logo.svg,logo-dark.svg,hooks-package.json→keep only if init still copies it,packs/*}`.

**CUT tests (delete):** all `change-*`, `compress`, `cost`, `dashboard-*`, `debt`, `journal-tail`, `lean`, `ledger-v2`, `maintain-*`, `map-mutations`, `practices`, `recall`, `review`, `review3`, `session`, `session-blackbox`, `stop-reminders`, `vector-store`, `walk` test files.

**KEEP tests (adapt):** `resume-cmd`, `resume-hook`, `resume-tickets`, `recovery`, `guard`, `formats`, `fs-atomic`, `foundations`, `features`, `integration`, `install`, `package`, `readme`, `runtime-parity`, `project-root`, `seed`, `solutions`, `setup.ts`.

---

### Task 1: Branch + bulk deletion, compiling skeleton

**Files:** Delete every file in the CUT lists above. Modify `src/cli/registry.ts`, `src/cli/index.ts`, `src/bin/packmind.ts`, `src/adapters/claude-code.ts`, `tsconfig.hooks.json` (hook file list if enumerated), `package.json` (remove optionalDependencies, remove `ignore` if now unused, version 2.0.0).

- [ ] `git checkout main && git pull && git checkout -b release/v2`
- [ ] Delete all CUT src files and CUT test files (`git rm`).
- [ ] Prune `cli/registry.ts` to register only: init, status, doctor, update, resume, mcp.
- [ ] Prune `adapters/claude-code.ts`: register only the 4 surviving hooks (SessionStart, UserPromptSubmit, PreToolUse Write|Edit|MultiEdit, StopFailure) and the MCP server; keep the `_managedBy` tagging, backup-once, strict-parse discipline unchanged; the hook script list constant must contain exactly the 4 surviving scripts.
- [ ] Chase every compile error from deleted imports: remove dead imports/branches in surviving files (doctor loses maintain-lock and index checks except resume recovery; init loses scan/map/journal/usage seeding; status reports brain files + hooks + ticket state only; update re-copies the 4 hooks; seed copies only surviving templates).
- [ ] In `.mcp.json` writer (in adapters or init): `{"command": "npx", "args": ["packmind", "mcp"]}`.
- [ ] In `src/cli/resume-cmd.ts`: delete the unconditional French log line (`deps.log("Fermez l'ancien processus Claude avant de continuer.")`, line ~154). Nothing replaces it.
- [ ] Run `pnpm build` until green. Tests may still be red; that is Task 3's job.
- [ ] Commit: `refactor!: remove cost, compress, dashboard, embeddings, change intelligence, practices, map and session ledger`

### Task 2: Guard dedup + slim schema/config

**Files:** Modify `src/guard/policy.ts`, `src/state/schema.ts`, `src/templates/config.json`, `src/templates/policy.json`. Test: `test/guard.test.ts`.

**Interfaces:** Produces `resolveRules(root: string): Rule[]` (or keep the existing resolve name) that returns DEFAULT_POLICY rules overlaid by policy.json rules, deduplicated by `rule.id` with the LOCAL rule winning (so a user can retune severity of a built-in rule without doubling it).

- [ ] Write failing test in `test/guard.test.ts`: a policy.json containing a rule with the same id as a built-in (`no-secret-files`) yields exactly ONE rule with that id, and it is the local variant (e.g. severity "block" wins over built-in "warn").
- [ ] Run it, expect FAIL (today both copies survive).
- [ ] Implement dedup in the resolver: build a `Map<string, Rule>` inserting defaults first then local rules (last write wins), return `[...map.values()]`.
- [ ] Slim `state/schema.ts` config to the surviving knobs only (project name, guard rules severity default, resume settings, paths). Remove cost.*, recall.*, map.*, dashboard.*, compress.*, practices keys and their deep-merge branches. Update `templates/config.json` and `templates/policy.json` accordingly.
- [ ] `pnpm build && pnpm test -- guard` green. Commit: `fix: guard rules dedup by id, local rule wins; slim config schema`

### Task 3: Slim runtime.ts + hooks + parity, prune remaining tests

**Files:** Modify `src/hooks/runtime.ts`, `src/hooks/{session-start,prompt-submit,pre-write,stop-failure}.ts`, `test/runtime-parity.test.ts`, and every KEEP test file. 

- [ ] Strip `runtime.ts` to only what the 4 hooks need: stdin reader, project root, config read, knowledge/handoff/solutions parsers, secret matcher + policy evaluation (with the Task 2 dedup), resume ticket store, atomic fs helpers. Delete mirrored estimator/pricing/map/describe/change/journal/session code.
- [ ] `session-start.ts`: keep handoff + Never-Do + solutions-count injection and the resume-ticket confirm/drop path; delete map/watchPaths/usage/change-baseline emission.
- [ ] `prompt-submit.ts`: keep lexical surfacing of past solutions (this code exists; it is the non-embeddings scorer); delete recall-index and map branches.
- [ ] `pre-write.ts`: keep evaluateWrite deny/warn emission; delete compress nudges, lean nudge, practice checks.
- [ ] `stop-failure.ts`: unchanged behavior; only imports may need adjusting.
- [ ] Update `test/runtime-parity.test.ts` to pin exactly the surviving canonical<->runtime mirrors (formats, secrets, policy eval, resume store).
- [ ] Adapt KEEP tests to the slimmed surface: `foundations/features/integration/install/seed/formats/solutions` lose assertions about deleted features; resume/guard/recovery/fs-atomic/project-root should pass nearly untouched. `test/package.test.ts`: assert tarball has no dashboard.html/packs and package.json has no optionalDependencies. `test/readme.test.ts` will be finalized in Task 5.
- [ ] `pnpm build && pnpm test` fully green. Commit: `refactor: runtime and hooks slimmed to session-start, prompt-submit, pre-write, stop-failure`

### Task 4: MCP server with 4 tools, lexical recall

**Files:** Modify `src/mcp/tools.ts`, `src/mcp/server.ts`. Test: `test/solutions.test.ts` + a new `test/mcp-recall.test.ts`.

**Interfaces:** Produces MCP tools `recall({query, limit?})`, `remember({text, section?})`, `record_solution({error, fix})`, `handoff({action: "get"|"set", content?})`. `recall` returns ranked snippets from knowledge.md, solutions.json, handoff.md using the same lexical scorer prompt-submit uses (share it via a canonical module, mirrored in runtime if needed by hooks only).

- [ ] Write failing test: seed a brain with a knowledge entry and two solutions; `recall("timeout postgres")` returns the matching solution first and never throws when brain files are missing.
- [ ] Delete embeddings-backed recall, compress, retrieve, project_map, usage_report, insights, debt, changes, review, record_evidence handlers and their schemas; implement lexical recall.
- [ ] `pnpm build && pnpm test` green. Commit: `feat!: MCP surface is recall (lexical), remember, record_solution, handoff`

### Task 5: README + CLAUDE.md rewrite (parallelizable in a worktree)

**Files:** Rewrite `README.md`, `CLAUDE.md`, `src/templates/claude-md-snippet.md`, `src/templates/PACKMIND.md`; delete `assets/` images that showcase removed features (verify with `ls assets/`); adapt `test/readme.test.ts`.

- [ ] README structure (clean, no feature it does not ship): hero one-liner ("PackMind resumes your rate-limited Claude Code session and gives your team a committed project memory Claude reads automatically."), badges (CI, npm, license), a short "Why" (2 paragraphs max), Install (`npm install -g packmind`, note: zero heavy deps, no postinstall), Quick start (init, what gets created, the 4 hooks, the 4 MCP tools), Resume section (how the ticket lifecycle works, requirements: Claude Code version with StopFailure event), Team memory section (knowledge/solutions/handoff, committed and diffable), Guardrails section (secret rules, policy.json, dedup/override semantics), Uninstall (exact steps), Security notes (loopback-free now, prompt-injection caveat for memory files as data-not-instructions), Contributing/License. English only. No cost/savings claims anywhere. No em dashes.
- [ ] CLAUDE.md: rewrite Architecture and conventions to the surviving tree (4 hooks, 4 tools, 6 commands); keep the critical conventions that still apply (zero-dep hooks, runtime parity, NodeNext, hermetic tests, release flow).
- [ ] `test/readme.test.ts`: assert every CLI command in README exists in registry and vice versa; assert no removed command is mentioned; assert no French text patterns.
- [ ] `pnpm test -- readme` green. Commit: `docs: README and CLAUDE.md rewritten for the 2.0 surface`

### Task 6: Final verification (E2E from the real tarball)

- [ ] `pnpm build && pnpm test` green; `pnpm audit --prod --audit-level=high` clean; expect ZERO vulnerability banner on `npm install` now that transformers is gone (verify).
- [ ] `npm pack` into a scratch dir; install into a fresh fake project; run `init`, `status`, `doctor`, `doctor --fix`, `update`, `resume` (expect clean "no ticket" exit 1), `mcp` JSON-RPC handshake listing exactly 4 tools.
- [ ] Pipe realistic JSON payloads through the 4 installed hooks: exit 0, valid-JSON-or-empty stdout; secret write warned once (not twice); StopFailure with a rate_limit payload creates a ticket; session-start confirms and drops it.
- [ ] Tarball hygiene: no dashboard.html, no packs, no map/journal templates; `files` field still tight.
- [ ] Commit anything the E2E shook out. Do NOT tag or publish; the release decision is the author's.
