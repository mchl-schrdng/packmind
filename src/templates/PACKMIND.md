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
