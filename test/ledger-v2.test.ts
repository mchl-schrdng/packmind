import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { brain, emptySession } from "../src/state/files.js";
import { emptyLedger, foldSessionIntoLedger, readLedger, type UsageLedger } from "../src/cost/ledger.js";

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ledv2-"));
  fs.mkdirSync(brain(dir).dir, { recursive: true });
  return dir;
}

describe("[P1] ledger schema v2", () => {
  it("still reads a v1 ledger on disk (tolerant reader)", () => {
    const dir = project();
    // A v1 ledger: version 1, rows without the new identity/model/source fields.
    const v1: UsageLedger = {
      version: 1,
      model: "claude-opus-4-8",
      createdAt: "t",
      totals: { inputTokens: 100, outputTokens: 10, inputCost: 1, outputCost: 0.5, reads: 2, writes: 1, sessions: 1, dedupedReads: 0, mapHits: 0 },
      sessions: [
        { id: "old", started: "t", ended: "t", inputTokens: 100, outputTokens: 10, inputCost: 1, outputCost: 0.5, reads: 2, writes: 1 },
      ],
    };
    fs.writeFileSync(brain(dir).usage, JSON.stringify(v1));

    const read = readLedger(dir, "claude-opus-4-8");
    expect(read.version).toBe(1); // preserved, not clobbered
    expect(read.totals.inputTokens).toBe(100);
    expect(read.sessions[0].id).toBe("old");
  });

  it("new rows persist the v2 identity/model/source fields", () => {
    const ledger = emptyLedger("m");
    expect(ledger.version).toBe(2);

    const s = {
      ...emptySession("inc-1"),
      sessionId: "raw-1",
      model: "claude-sonnet-5",
      initialSource: "startup",
      lastSource: "clear",
      status: "active" as const,
      cwd: "/work/tree",
      inputTokens: 50,
    };
    foldSessionIntoLedger(ledger, s, "endts");

    const row = ledger.sessions.find((r) => r.id === "inc-1")!;
    expect(row.sessionId).toBe("raw-1");
    expect(row.model).toBe("claude-sonnet-5");
    expect(row.initialSource).toBe("startup");
    expect(row.lastSource).toBe("clear");
    expect(row.status).toBe("active");
    expect(row.cwd).toBe("/work/tree");
    // totals math unchanged by the added fields
    expect(ledger.totals.inputTokens).toBe(50);
  });
});
