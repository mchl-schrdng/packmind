import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ticketFile,
  listTickets,
  readTicket,
  blockTicket,
  tryAcquireLaunch,
  releaseLaunch,
  removeTicket,
} from "../src/state/resume.js";

function tmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pm-resume-"));
}
const NOW = "2026-07-13T10:00:00.000Z";

describe("resume ticket store", () => {
  it("ticketFile hashes the session id (sha256, 16 hex) under state/resume-tickets", () => {
    const root = tmpRoot();
    const f = ticketFile(root, "abc123");
    expect(f).toContain(path.join(".packmind", "state", "resume-tickets"));
    expect(path.basename(f)).toMatch(/^[0-9a-f]{16}\.json$/);
    // injective: different ids, different files
    expect(ticketFile(root, "other")).not.toBe(f);
  });

  it("blockTicket creates a v1 blocked ticket with the exact session id", () => {
    const root = tmpRoot();
    blockTicket(root, "abc123", NOW);
    const t = readTicket(root, "abc123")!;
    expect(t).toMatchObject({
      version: 1,
      sessionId: "abc123",
      status: "blocked",
      createdAt: NOW,
      updatedAt: NOW,
      reconcileRequested: true,
    });
    expect(t.resetAt).toBeUndefined(); // never invented
  });

  it("blockTicket keeps createdAt and re-blocks an existing ticket (new rate limit)", () => {
    const root = tmpRoot();
    blockTicket(root, "abc123", NOW, "2026-07-13T11:00:00.000Z");
    expect(tryAcquireLaunch(root, "abc123", NOW)).toBe(true);
    expect(readTicket(root, "abc123")!.status).toBe("launching");
    const later = "2026-07-13T10:30:00.000Z";
    blockTicket(root, "abc123", later);
    const t = readTicket(root, "abc123")!;
    expect(t.status).toBe("blocked");
    expect(t.createdAt).toBe(NOW);
    expect(t.updatedAt).toBe(later);
    expect(t.resetAt).toBe("2026-07-13T11:00:00.000Z"); // prior reset kept when new one unknown
  });

  it("tryAcquireLaunch succeeds once; a concurrent second call is refused", () => {
    const root = tmpRoot();
    blockTicket(root, "abc123", NOW);
    expect(tryAcquireLaunch(root, "abc123", NOW)).toBe(true);
    expect(tryAcquireLaunch(root, "abc123", NOW)).toBe(false);
    releaseLaunch(root, "abc123", NOW);
    expect(readTicket(root, "abc123")!.status).toBe("blocked");
    expect(tryAcquireLaunch(root, "abc123", NOW)).toBe(true);
  });

  it("tryAcquireLaunch on a missing ticket is refused", () => {
    const root = tmpRoot();
    expect(tryAcquireLaunch(root, "ghost", NOW)).toBe(false);
    expect(listTickets(root)).toEqual([]); // no null-file leftover
  });

  it("listTickets returns every parseable ticket; removeTicket deletes", () => {
    const root = tmpRoot();
    blockTicket(root, "a", NOW);
    blockTicket(root, "b", NOW);
    expect(listTickets(root).map((t) => t.sessionId).sort()).toEqual(["a", "b"]);
    removeTicket(root, "a");
    expect(listTickets(root).map((t) => t.sessionId)).toEqual(["b"]);
    expect(listTickets(tmpRoot())).toEqual([]); // no dir -> empty
  });
});
