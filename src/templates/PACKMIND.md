# PackMind brain

This directory is the project's memory for Claude Code. The durable files are
**committed and shared**: every teammate and every future session starts from
the same knowledge. Review changes to them in pull requests like any other
code.

## Files

- **`knowledge.md`** - durable lessons about this project. The `## Never Do`
  section is surfaced to Claude at the start of every session; keep it short
  and non-negotiable. Add entries with the `remember` MCP tool or by hand.
- **`solutions.json`** - error-to-fix pairs recorded via the `record_solution`
  MCP tool. When a new prompt matches a past error, the fix is surfaced
  automatically before work starts.
- **`handoff.md`** - where the last session left off. Set it with the `handoff`
  MCP tool before stopping; it is injected at the next session start.
- **`policy.json`** - guard rules checked before every file write.
- **`config.json`** - PackMind settings for this project.

Runtime state (resume tickets, locks) also lives here but is gitignored; only
the files above are meant to be committed.

## Overriding a guard rule

Rules are resolved by id and the local rule wins. To harden the built-in
secret-file warning into a hard block, add to `policy.json`:

```json
{ "rules": [{ "id": "no-secret-files", "severity": "block" }] }
```

One id, one rule: the local definition replaces the built-in one instead of
stacking on top of it.
