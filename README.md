<p align="center">
  <img src="https://raw.githubusercontent.com/mchl-schrdng/packmind/main/packmind-mark.svg" alt="PackMind" width="120" />
</p>

<h1 align="center">PackMind</h1>

<p align="center">
  <strong>A local second brain for Claude Code.</strong><br />
  PackMind preserves project memory across Claude Code sessions, helps avoid repeated reads, and safely resumes a rate-limited session when the user asks it to.
</p>

<p align="center">
  <a href="https://github.com/mchl-schrdng/packmind/actions/workflows/ci.yml"><img src="https://github.com/mchl-schrdng/packmind/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/mchl-schrdng/packmind/blob/main/badges/coverage.svg"><img src="https://raw.githubusercontent.com/mchl-schrdng/packmind/main/badges/coverage.svg" alt="Coverage" /></a>
  <a href="https://github.com/mchl-schrdng/packmind/actions/workflows/codeql.yml"><img src="https://github.com/mchl-schrdng/packmind/actions/workflows/codeql.yml/badge.svg" alt="CodeQL" /></a>
  <a href="https://www.npmjs.com/package/packmind"><img src="https://img.shields.io/npm/v/packmind.svg" alt="npm" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-blue.svg" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/Node.js-20%2B-green.svg" alt="Node.js 20+" />
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/mchl-schrdng/packmind/main/assets/dashboard.gif" alt="PackMind dashboard - Overview, Insights, Project Map, Journal, and Recall" width="800" />
</p>

---

## Contents

- [The problem it solves](#the-problem-it-solves)
- [Install in five minutes](#install-in-five-minutes)
- [How it works](#how-it-works)
- [Resuming after a rate limit](#resuming-after-a-rate-limit)
- [Lifecycle hooks](#lifecycle-hooks)
- [MCP tools](#mcp-tools)
- [CLI commands](#cli-commands)
- [What lives in `.packmind/`](#what-lives-in-packmind)
- [Configuration](#configuration)
- [Maintenance via cron (no daemon)](#maintenance-via-cron-no-daemon)
- [Local data & privacy](#local-data--privacy)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Requirements](#requirements)
- [Uninstall](#uninstall)
- [Contributing](#contributing)
- [License](#license)

## The problem it solves

Claude Code works without persistent project context: it can't tell a 50-token
config from a 2,000-token module before opening it, re-reads the same files,
forgets what it learned last session - and when a usage limit cuts a session
off, that exact session is stranded until you piece things back together by
hand. PackMind fixes that with a small state directory (`.packmind/`)
maintained by lifecycle hooks, an MCP server that exposes the project's memory
as tools Claude can query directly, and a local resume ticket that lets you
relaunch the exact rate-limited session - explicitly, safely, once.

- **Project map** - every file gets a one-line description, a token estimate, and
  an estimated read cost, so Claude reads `map.md` instead of opening files blind.
- **Estimated token &amp; cost activity** - fast local estimates always, priced per
  model into a running **dollar total**. Exact reconciliation via Anthropic's
  count-tokens API is **opt-in** (`packmind scan --exact`), so nothing leaves your
  machine by default.
- **Local semantic recall** - an on-device embedding index (nothing leaves your
  machine) lets Claude `recall(...)` past decisions, solutions, and code by meaning.
- **Rate-limit resume** - a `StopFailure: rate_limit` event records a local
  ticket for the interrupted session; `packmind resume` relaunches it with
  `claude --resume <session-id>` when you ask, optionally waiting for the reset.
- **Active guardrails** - a policy engine warns (or hard-blocks, opt-in) before a
  write touches a secret file or violates a project rule.
- **Practice packs** - installable sets of engineering reflexes (tests, CI, release
  hygiene, security) that nudge at the right moment. Session-level checks like
  "`src/**` changed but no test written" can be satisfied with the `record_evidence`
  tool so they stay quiet once you've done the thing. Manage with `packmind practice`.
- **Lean mode** - a reuse-first decision ladder that nudges Claude to build less
  (`off` / `lite` / `full`), with a `packmind:` shortcut convention you harvest via `debt`.
- **Reversible compression** - shelve a large non-source output (log, JSON, command dump)
  with `compress(...)` and pull the exact original back with `retrieve(hash)`, to keep the
  session's context lean.
- **Session-aware** - accounting and reminders are keyed to Claude's real session id, so
  concurrent sessions and worktrees are tracked separately (no shared global file). Resume
  and compaction continue a session, `/clear` starts a fresh one, and each closes into its
  own usage-ledger row on `SessionEnd`.
- **Live change intelligence** - PackMind tracks the net set of files changed during a
  session (add / modify / delete / rename) from ANY source - Write/Edit, Bash, generators,
  parallel tool batches, or external editors - and keeps the map, recall, and practice checks
  in sync with it. Inspect it with `packmind changes` or the `changes` MCP tool.

## Install in five minutes

```bash
npm install -g packmind          # or: pnpm add -g packmind
cd your-project
packmind init                    # sets up .packmind/, hooks, and the MCP server
packmind index                   # builds the local semantic index (first run fetches the embed model)
```

Then use `claude` as normal - the hooks and MCP server do their work in the
background. To skip the optional local-recall dependency entirely (smaller,
CVE-clean install), use `npm install -g packmind --omit=optional` and set
`recall.enabled: false`.

Commit the durable brain files (`map.md`, `knowledge.md`, `config.json`,
`policy.json`) so your whole team shares the same project memory. See
[What lives in `.packmind/`](#what-lives-in-packmind) for the full commit guide.

Already running an older PackMind? `packmind upgrade` bumps the installed
package, then `packmind update` refreshes every registered project (hooks
included - this is how existing projects receive `stop-failure.js`).

## How it works

```mermaid
flowchart TD
    U["User runs Claude Code"] --> H["PackMind lifecycle hooks"]
    H --> S["Local .packmind state"]
    H --> M["PackMind MCP tools"]

    H -->|"StopFailure: rate_limit"| T["Local resume ticket"]
    T --> R["User runs packmind resume --wait"]
    R --> Q{"Reset time reached?"}
    Q -->|"Not yet"| W["Foreground countdown"]
    W --> Q
    Q -->|"Ready"| C["claude --resume session-id"]
    Q -->|"Reset unknown"| I["Ask user to retry after reset"]
    C --> S

    CR["User-configured cron"] --> MT["packmind maintain --quiet"]
    MT --> S
```

What this diagram guarantees:

- Resuming requires an **explicit user action** (`packmind resume`); nothing is relaunched automatically.
- PackMind **does not bypass Claude usage limits** - it only waits for the recorded reset and then resumes the exact session.
- The cron job only maintains **local data**; it **never launches Claude** and never consumes Claude tokens.
- **No PackMind daemon** runs in the background - everything is short-lived hooks and one-shot commands.

PackMind has three moving parts, all local:

1. **Lifecycle hooks** - small, zero-dependency Node scripts copied into
   `.packmind/hooks/` and registered in `.claude/settings.json` (tagged
   `_managedBy: packmind` so they are preserved and removable cleanly). Claude
   Code runs them on its own events (session start/end, prompt submit, before and
   after each Read/Write, turn stop, and rate-limit failures). They maintain the
   map, journal, usage ledger, and session state, and feed short reminders back
   into the model.
2. **MCP server** - registered in `.mcp.json`, it exposes the brain as tools
   Claude can call directly (`recall`, `remember`, `record_solution`, and more).
3. **State directory** - `.packmind/`, a set of plain files (Markdown + JSON) you
   can read, diff, and commit.

Nothing runs as a daemon and nothing opens a network port except the opt-in
`packmind dashboard` (loopback only). The CLI is how you inspect and maintain the
brain from the terminal.

### Change-tracking coverage

Live change intelligence is event-assisted and reconciliation-backed: hook events
make updates appear quickly, and reconciliation establishes correctness.

- **Git projects** reconcile in-process at the end of each turn, so Bash, generator,
  parallel-batch, and external-editor changes are reflected in the net change set,
  the map, recall, and practice checks - not just direct `Write`/`Edit` calls.
- **Non-git projects** capture a bounded file-fingerprint baseline at session start
  and reconcile fully via that manifest when you run `packmind reconcile` or
  `packmind maintain`. (`packmind changes` is read-only - it displays the last
  reconciled set without recomputing.)
- Only **eligible** files are tracked - the same secret, binary, size, and
  (in git projects) gitignore rules as the project map; non-git manifest walks are
  additionally bounded by `map.maxFiles`. Ignored, secret, binary, oversized,
  symlinked-out-of-root, and out-of-root files never enter the change set.
- External-edit watching (`FileChanged`) depends on the host emitting watch paths;
  **reconciliation, not file watching, is the completeness mechanism**, so PackMind
  never claims to watch every possible future file or to prevent a change that a
  post-change hook only observes after it happened.

## Resuming after a rate limit

When a turn ends on a `rate_limit` API error, Claude Code fires the
`StopFailure` hook (its output is ignored by Claude - the hook can only record
state). PackMind writes a small local ticket at
`.packmind/state/resume-tickets/<session-id-hash>.json` with the session id, a
`blocked` status, and - only when `error_details` clearly states one ("retry
after 60 seconds", or an explicit timestamp) - the reset time. The ticket never
contains messages, transcripts, secrets, or source content.

```bash
packmind resume                # resume the only blocked session
packmind resume --session <id> # pick one when several are blocked
packmind resume --wait         # foreground countdown, launch at reset time
```

Behavior:

- Reset already passed → launches `claude --resume <session-id>` immediately.
- Reset in the future without `--wait` → prints the reset time and launches nothing.
- Reset in the future with `--wait` → visible countdown, then a single launch.
  Ctrl-C aborts without launching; the ticket is kept.
- Reset unknown with `--wait` → nothing is launched; retry after the limit resets.
- Reset unknown without `--wait` → warns, then launches, because you asked explicitly.
- Close the previous Claude process first - PackMind refuses concurrent resumes
  of the same session and launches exactly once (argument array, inherited
  terminal, from the validated project root).

When the session actually comes back, the `SessionStart` hook reconciles the
interrupted turn's changes (Bash and external edits included) and drops the
ticket. If Claude exits without confirming the resume - or hits the limit
again - the ticket returns to `blocked` so `packmind resume` can be retried;
a launch orphaned by a hard kill can be recovered with `packmind doctor --fix`
after six hours.

## Lifecycle hooks

Installed into `.packmind/hooks/` and wired into `.claude/settings.json` by
`packmind init`. Each is standalone and fail-safe (an error never blocks your
tool call).

| Event | Hook | What it does |
|-------|------|--------------|
| `SessionStart` | `session-start.js` | Opens or reattaches this session's record (keyed by the real `session_id`), injects the handoff note, a "check `map.md` first" reminder, and the session id into context. `resume`/`compact` continue the session; `/clear` folds the old one into the ledger and starts a fresh incarnation. A pending resume ticket for the session triggers a reconcile, then the ticket is dropped. |
| `UserPromptSubmit` | `prompt-submit.js` | Lexically matches your prompt against recorded solutions and surfaces likely-relevant past fixes before Claude even calls a tool. |
| `PreToolUse: Read` | `pre-read.js` | Before a read: warns if the file was already read unchanged this session (wasteful re-read), surfaces its `map.md` description + token estimate, and suggests `compress()` for large non-source files. |
| `PreToolUse: Write/Edit/MultiEdit` | `pre-write.js` | Before a write: evaluates the guardrail policy (warn, or hard-block secrets/rules when enabled), surfaces relevant recorded solutions and `knowledge.md` never-do notes, and emits the lean-mode reuse nudge. |
| `PostToolUse: Read` | `post-read.js` | After a read: reconciles the token and cost accounting for that file. |
| `PostToolUse: Write/Edit/MultiEdit` | `post-write.js` | After a write: refreshes the file's `map.md` entry, appends to the journal, updates accounting, queues the file for recall re-embedding, and nudges after repeated edits to the same file. |
| `PostToolBatch` | `post-tool-batch.js` | After a batch of (possibly parallel) tool calls: coalesces direct writes into change candidates and flags a reconcile when Bash, a file-writing MCP tool, or an unknown tool ran. Inspects tool names/inputs only, never the tool response. |
| `FileChanged` | `file-changed.js` | A watched file changed on disk (add/change/unlink) outside the direct tools: records an eligible, in-root change candidate. Fires for the paths `SessionStart` emits via `watchPaths`. |
| `Stop` | `stop.js` | End of each turn: reconciles the net change set (git), syncs map + recall, folds usage into the lifetime ledger, refreshes the handoff, and emits at-most-once reminders. |
| `StopFailure` (matcher `rate_limit`) | `stop-failure.js` | A turn ended on a rate-limit API error: records the local resume ticket for the exact session. Claude ignores this hook's output entirely - it never retries, relaunches, or works around the limit. |
| `SessionEnd` | `session-end.js` | When a session ends: a final reconcile, folds into the ledger, then on a terminal end removes the live session file and refreshes the handoff; on `resume` it suspends and keeps the file. |

## MCP tools

Registered automatically in `.mcp.json`. Claude can call:

| Tool | Purpose |
|------|---------|
| `recall(query)` | Semantic search across knowledge, journal, solutions, and source code (uses the local vector index). |
| `remember(note, kind)` | Save a durable `Preferences` / `Decisions` / `Never Do` / `Notes` / `Debt` entry into `knowledge.md`. |
| `record_solution(error, cause, fix, tags, file?)` | Log a bug and its fix so it is never rediscovered; recording the same error again bumps its occurrence count. |
| `record_evidence(check, detail?, session_id?)` | Mark a practice check satisfied this session so its Stop-hook nudge stays quiet. Pass `session_id` (shown at SessionStart) when several sessions are active. |
| `project_map(filter?)` | List mapped files with descriptions and token estimates, optionally filtered. |
| `usage_report()` | Model, session count, reads/writes, tokens, and dollar cost for the project. |
| `insights()` | Estimated savings, map coverage, heaviest files, upkeep flags, and the compression store. |
| `handoff(action, content?)` | Read or update the session resume note (`get` / `set`). |
| `debt()` | List `packmind:` deferred-shortcut markers left in the code. |
| `changes(session_id?)` | The session's net change set (files different from session start, from any source) with per-file map and recall status. Read-only. |
| `review(base?)` | Package the current git diff with the lean decision ladder for an over-engineering review. |
| `compress(content, kind?)` | Shelve a large non-source output and get a compact, reversible preview plus a retrieval hash. |
| `retrieve(hash)` | Return the full original a `compress` call stored. |

## CLI commands

Run any command inside a project (a directory with `.packmind/`). `packmind
<command> --help` prints usage.

### Setup and lifecycle

| Command | What it does |
|---------|--------------|
| `packmind init` | Create `.packmind/` (config + seed brain files + hooks), register the lifecycle hooks in `.claude/settings.json`, register the MCP server in `.mcp.json`, wire a snippet into `CLAUDE.md`, resolve the effective guard set, and run an initial map scan. Idempotent - safe to re-run. |
| `packmind resume [--session <id>] [--wait]` | Resume a rate-limited Claude Code session from its local ticket by launching `claude --resume <session-id>` once. `--session` selects one when several tickets exist; `--wait` counts down in the foreground until the recorded reset time. See [Resuming after a rate limit](#resuming-after-a-rate-limit). |
| `packmind update [--dry-run] [--list] [--project <name>]` | Update every registered project to the current PackMind version: snapshot first, re-copy the hooks, re-register, and refresh the effective guard set, all while preserving `config.json`. `--dry-run` shows what would change; `--list` lists registered projects; `--project` limits to one. |
| `packmind upgrade [--check]` | Upgrade PackMind **itself** to the latest published version: detect the package manager (npm/pnpm/yarn), install `packmind@latest`, then refresh registered projects via `packmind update`. `--check` only reports whether a newer version exists and prints the command to run. (Note: `update` refreshes projects; `upgrade` bumps the installed package.) |
| `packmind doctor [--fix]` | Diagnose registered projects, hook installation, and MCP registration; report what is installed, stale, or missing. `--fix` repairs what is safely repairable: removes a maintain lock older than six hours and resets a resume launch orphaned for more than six hours. |
| `packmind mcp` | Run the MCP server over stdio. Claude Code invokes this for you - you rarely run it by hand. |

### Map and accounting

| Command | What it does |
|---------|--------------|
| `packmind scan [--check] [--exact]` | Rebuild `map.md` by walking the project (honoring `.gitignore`, secret globs, and size caps), describing each file with a token and cost estimate. `--check` exits `1` if the map is stale (for CI). `--exact` reconciles counts via Anthropic count-tokens (needs `ANTHROPIC_API_KEY`). |
| `packmind status` | Print token usage, dollar cost, session count, and project health from the usage ledger. |
| `packmind insights` | Show where tokens go and what PackMind saved: estimated savings, re-reads avoided, map coverage, heaviest files, upkeep flags, and the compression store. |

### Memory and recall

| Command | What it does |
|---------|--------------|
| `packmind index` | Build the local semantic recall index. The first run downloads the embedding model (cached under `~/.packmind/models`); everything after is offline. |
| `packmind recall <query...>` | Semantic search across knowledge, journal, solutions, and source from the terminal. |
| `packmind solutions <term>` | Search recorded bug solutions by term. |
| `packmind debt` | List `packmind:` deferred-shortcut markers (the lean-mode debt ledger). |

### Change intelligence

| Command | What it does |
|---------|--------------|
| `packmind changes [--session <id>] [--json]` | Show the current session's net change set: files added, modified, deleted, or renamed since the session started, from any source, with per-file map and recall status. `--session` selects one when several are active; `--json` prints the raw `ChangeSetV1`. |
| `packmind reconcile [--session <id>] [--json]` | Force a full reconciliation (git status, or a file-fingerprint manifest for non-git projects) and synchronize the map and recall queue. Succeeds even when there are no changes. |

### Guardrails and practices

| Command | What it does |
|---------|--------------|
| `packmind policy check` | Lint `policy.json` guardrail rules and report any invalid entries. |
| `packmind practice list` | List the bundled practice packs and which are active. |
| `packmind practice add <pack>` | Activate a practice pack (adds its rules and session checks to the effective guard set). |
| `packmind practice remove <pack>` | Deactivate a practice pack. |
| `packmind practice explain <path>` | Show which rules and checks apply to a given path. |

### Backups and maintenance

| Command | What it does |
|---------|--------------|
| `packmind backup [--list]` | Snapshot `.packmind/` to `~/.packmind/backups/<project>/<timestamp>` (skipping the regenerable vector index). `--list` lists existing snapshots. |
| `packmind restore [timestamp]` | Restore `.packmind/` from a backup. Takes a pre-restore snapshot and swaps atomically so a failed restore can't lose your brain. Omit the timestamp to list available backups. |
| `packmind maintain [--quiet] [--keep-backups <n>]` | One-shot, cron-safe upkeep under an exclusive lock: reconcile active sessions, refresh the map, process the recall queue incrementally, archive an overgrown journal, prune only genuinely finalized session files, then prune old backups (skipped if any earlier step failed). `--quiet` hides successes, never errors; `--keep-backups` takes an integer 1-1000 (default 10), validated before anything is touched. See [Maintenance via cron](#maintenance-via-cron-no-daemon). |
| `packmind dashboard [--port <port>] [--no-open]` | Launch the local web dashboard (Overview, Insights, Project Map, Journal, Recall, Config). Binds to loopback only and is token-protected. `--port` sets a preferred port (default 7878); `--no-open` skips auto-opening the browser. |

## What lives in `.packmind/`

| File | Role | Commit? |
|------|------|---------|
| `map.md` | File map with tokens &amp; cost | yes |
| `knowledge.md` | Preferences, decisions, never-do list | yes |
| `identity.md` | Persistent project identity notes | yes |
| `config.json` | Configuration | yes |
| `policy.json` | Guardrail rules (your local overrides) | yes |
| `PACKMIND.md` | Protocol Claude follows | yes |
| `guard.effective.json` | Resolved guard set (default + packs + policy.json) | no (derived) |
| `journal.md` | Action log + session summaries | optional |
| `solutions.json` | Recorded fixes | optional |
| `usage.json` | Token &amp; cost ledger | no (per-dev) |
| `handoff.md` | Session resume note | no (per-dev) |
| `state/sessions/` | Per-session live state (keyed by session id) | no (per-dev) |
| `state/resume-tickets/` | Rate-limit resume tickets (lifecycle metadata only) | no (per-dev) |
| `compress/` | Reversible shelved-output store | no (per-dev) |
| `recall/` | Local vector index | no (per-dev) |

`packmind init` seeds a `.packmind/.gitignore` that keeps exactly the per-dev
rows above out of git while the shared brain files stay tracked.

## Configuration

`.packmind/config.json` is deep-merged over defaults, so it survives `packmind
update` and stays forward-compatible. Notable keys:

- `model` - drives cost pricing (`claude-opus-4-8` by default).
- `cost.exact` - when `scan` reconciles to exact counts: `never` (default, no
  network) | `auto` (exact when `ANTHROPIC_API_KEY` is set) | `always`. You can
  always force it per-run with `packmind scan --exact`. Hooks always use the fast
  local estimate.
- `cost.prices` - override the built-in (approximate) per-model rates, e.g.
  `{ "claude-opus-4-8": { "inputPerMTok": 5, "outputPerMTok": 25 } }`. The
  defaults are best-effort; set this to your account's actual pricing.
- `recall.enabled` / `recall.embedModel` - local embeddings; fully offline.
- `guard.blockSecrets` - set `true` to hard-block writes to secret files.
- `guard.practices` - active practice packs (e.g. `quality-core`,
  `release-manager`), managed with `packmind practice add|remove|list|explain`.
- `guard.lean.mode` - the reuse-first nudge before writes: `off` | `lite` | `full` (default `lite`).
- `map.respectGitignore`, `map.extraSecretGlobs` - control what gets mapped.

## Maintenance via cron (no daemon)

Instead of a background daemon, PackMind ships a single `maintain` command you
schedule yourself. PackMind installs no scheduler:
**it never creates, modifies, or deletes your crontab**.
Add a line yourself if you want unattended upkeep:

```cron
# Tous les jours à 02:00
0 2 * * * cd /chemin/absolu/projet && /chemin/absolu/packmind maintain --quiet >> /chemin/absolu/packmind-maintain.log 2>&1
```

Each run validates everything before touching anything
(`packmind maintain --keep-backups <n>` only accepts an integer from 1 to
1000), then takes an exclusive lock -
`.packmind/state/maintain.lock/` - so two maintains can never overlap: a second
concurrent run exits with code `3`, and a lock is never stolen (a crashed run's
lock older than six hours is removed by `packmind doctor --fix`, never by
`maintain` itself). The steps then run in order: reconcile active sessions,
refresh the map, process the recall queue incrementally, archive an overgrown
journal, delete only genuinely finalized session files (active and suspended
sessions are never removed by age), and finally prune backups - skipped
entirely if any earlier step failed. It never launches Claude and never
consumes Claude tokens. `--quiet` hides successes, never errors; errors go to
stderr so your cron log captures them.

Exit codes: `0` success · `1` invalid arguments or config · `2` partial
failure · `3` another maintenance is active.

## Local data & privacy

Everything lives in `.packmind/` inside your project, plus `~/.packmind` for
backups, the project registry, and the cached embedding model. Embeddings run
locally; your code is never sent anywhere for recall. The only optional network
call is Anthropic's count-tokens endpoint, off by default and used only when
you opt into exact counting (`cost.exact` other than `never`, or
`packmind scan --exact`). Resume tickets contain lifecycle metadata only -
never API messages, transcripts, secrets, or source content.

## Security

- **Dependency CVEs** are scanned on every CI run (`pnpm audit`): the build gates
  on the core/shipped tree at `--audit-level=high`; a full-tree audit runs as
  informational.
- **Core dependencies carry no known high/critical advisories.** The only source
  of transitive advisories is the **optional** local-recall dependency
  (`@xenova/transformers`), which bundles an older ML runtime. It is never
  required - install without it (`npm install packmind --omit=optional`) for a
  CVE-clean tree, or set `recall.enabled: false`. Migrating recall to the
  maintained `@huggingface/transformers` is tracked future work.
- **Code scanning** via CodeQL runs when the repository is public (or has GitHub
  Advanced Security); the workflow is skipped, not failed, otherwise.
- Found something? See [the repo issues](https://github.com/mchl-schrdng/packmind/issues).

## Known limitations

- Resume depends on Claude Code's `StopFailure` hook event; older Claude Code
  versions that don't ship it simply never create tickets (everything else
  works). The hook's payload has no structured reset field - PackMind parses
  the `error_details` message conservatively ("retry after N seconds" or an
  explicit timestamp) and **never guesses**: without a clear reset time,
  `--wait` asks you to retry instead of waiting blind, so expect
  `packmind resume` (without `--wait`) to be the common path.
- One resume ticket per session id; the ticket is dropped when the session
  demonstrably starts again, and re-created if the limit hits again.
- In-hook change reconciliation is git-based; non-git projects reconcile fully
  via `packmind reconcile` or `packmind maintain` (manifest baseline).
- Token/cost figures are estimates unless reconciled with `packmind scan --exact`.
- Semantic recall needs the optional `@xenova/transformers` dependency; without
  it, recall steps are skipped (visibly, on stderr, but without failing `maintain`).

## Requirements

- Node.js 20+
- Claude Code (rate-limit resume needs a version that ships the `StopFailure` hook event)

## Uninstall

Remove the `_managedBy: "packmind"` hook groups from `.claude/settings.json`
(or restore the one-time `settings.json.packmind-bak` backup), remove the
`packmind` entry from `.mcp.json`, delete `.packmind/` in the project and
`~/.packmind` globally, then `npm uninstall -g packmind`. `packmind doctor`
shows what is registered where before you start.

## Contributing

Issues and pull requests are welcome. Development uses pnpm and Vitest:

```bash
pnpm install
pnpm build      # compiles the ESM library and the CommonJS hooks
pnpm test       # runs the Vitest suite
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE).
