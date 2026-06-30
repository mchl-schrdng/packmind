# PACKMIND.md — Operating Protocol

PackMind gives you (Claude) a persistent second brain for this project, stored in
`.packmind/`. It surfaces context automatically through hooks and exposes tools
through the **packmind** MCP server. Follow this protocol each session.

## Before reading a file
- Check `map.md` first — if a file's description and token/cost estimate answer
  your question, don't open the whole file.
- Don't re-read a file you already read this session unless it changed.

## Before writing code
- Heed any guardrail warnings (they reference `policy.json` and the secrets
  denylist). A blocked write means policy forbids it — choose another path.
- Honor the `## Never Do` list in `knowledge.md`.

## Lean by default: the decision ladder
The best code is the code you don't write. Once you understand the problem (read
the code the change touches, trace the real flow), stop at the first rung that holds:
1. Does this need to exist at all? If not, don't build it.
2. Already in this codebase? Reuse the helper, util, or pattern.
3. Standard library? Use it.
4. Native platform feature? Use it.
5. Already-installed dependency? Use it.
6. Can it be one line? Make it one line.
7. Only then: write the minimum that works.

Never simplify away input validation at trust boundaries, error handling that
prevents data loss, security, or accessibility. Non-trivial logic leaves one
runnable check behind. Lean means efficient, not careless.

When you take a deliberate shortcut, mark it with a `packmind:` comment naming the
known ceiling and the upgrade path, e.g. `// packmind: O(n^2) scan; upgrade to an
index if N grows`.

Mode is set by `guard.lean.mode` in `config.json` (`off` | `lite` | `full`).

## Use the MCP tools
- `recall("…")` — semantic search across project memory. Use it before
  investigating a bug or re-deriving how something works.
- `remember(note, kind)` — save a preference, decision, never-do rule, or note.
- `record_solution(error, cause, fix, tags)` — log a fix so it's never
  rediscovered.
- `project_map(filter?)` — list files with descriptions and token estimates.
- `usage_report()` — token usage and dollar cost so far.
- `handoff("get"|"set", content?)` — read or update the resume note.

## When you finish meaningful work
- `remember` durable lessons/preferences/decisions.
- `record_solution` for any real bug you fixed.
- `handoff("set", …)` with where things stand and what's next.

## Files in `.packmind/`
| File | Purpose |
|------|---------|
| `map.md` | File map: description, token estimate, est. read cost |
| `knowledge.md` | Preferences, decisions, never-do list, notes |
| `journal.md` | Chronological action log + session summaries |
| `solutions.json` | Known bugs and their fixes |
| `usage.json` | Token + dollar-cost ledger |
| `handoff.md` | Session resume note |
| `policy.json` | Guardrail rules |
| `recall/` | Local semantic index (never leaves your machine) |
