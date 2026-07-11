import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { findRoot } from "../state/project.js";
import { pkgVersion } from "../cli/locate.js";
import {
  makeContext,
  isInitialized,
  toolRecall,
  toolRemember,
  toolRecordSolution,
  toolRecordEvidence,
  toolProjectMap,
  toolUsageReport,
  toolInsights,
  toolHandoff,
  toolDebt,
  toolReview,
  toolCompress,
  toolRetrieve,
} from "./tools.js";

const TOOLS = [
  {
    name: "recall",
    description: "Semantic search over PackMind's project memory (knowledge, journal, solutions, source). Use before investigating or re-deriving anything.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for" } },
      required: ["query"],
    },
  },
  {
    name: "remember",
    description: "Record a durable preference, decision, never-do rule, or note into project knowledge.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string" },
        kind: { type: "string", enum: ["Preferences", "Decisions", "Never Do", "Notes", "Debt"] },
      },
      required: ["note"],
    },
  },
  {
    name: "record_solution",
    description: "Record a bug and its fix so it is never re-investigated. Recording the same error again bumps its occurrence count.",
    inputSchema: {
      type: "object",
      properties: {
        error: { type: "string" },
        cause: { type: "string" },
        fix: { type: "string" },
        file: { type: "string", description: "Optional file path the bug relates to" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["error"],
    },
  },
  {
    name: "record_evidence",
    description: "Mark a practice check as satisfied this session (e.g. tests ran, a workflow was reviewed, a change is doc-only) so its Stop-hook nudge stays quiet. Call it when you have done the thing a practice reminder asked for, or when it legitimately doesn't apply.",
    inputSchema: {
      type: "object",
      properties: {
        check: { type: "string", description: "The check name to satisfy, e.g. tests-updated, workflow-reviewed, release-checked" },
        detail: { type: "string", description: "Optional note, e.g. why it does not apply" },
        session_id: { type: "string", description: "Which session to attach to (the PackMind session id shown at SessionStart). Only needed when several sessions are active." },
      },
      required: ["check"],
    },
  },
  {
    name: "project_map",
    description: "List the project's files with descriptions and token estimates. Optional substring filter.",
    inputSchema: { type: "object", properties: { filter: { type: "string" } } },
  },
  {
    name: "usage_report",
    description: "Token usage and dollar cost for this project (lifetime).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "insights",
    description: "Where tokens go and what PackMind saved: cost, estimated savings, map coverage, heaviest files, and upkeep notes.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "handoff",
    description: "Get or set the session handoff note ('where we are / what's next').",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set"] },
        content: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "debt",
    description: "List `packmind:` deferred-shortcut markers left in the code (the lean-mode debt ledger) so 'later' doesn't become 'never'.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "review",
    description: "Package the current diff (working tree vs HEAD, or vs a base ref) with the lean decision ladder so you can review it for over-engineering and produce a delete-list.",
    inputSchema: {
      type: "object",
      properties: { base: { type: "string", description: "Optional base ref to diff against instead of HEAD" } },
    },
  },
  {
    name: "compress",
    description: "Stash a large NON-source output (log, JSON, command or search dump) you don't need verbatim: stores the original locally and returns a compact, reversible preview plus a retrieval hash. Never use on source code you need exact.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The large text to shelve" },
        kind: { type: "string", description: "Optional label, e.g. log / json / search" },
      },
      required: ["content"],
    },
  },
  {
    name: "retrieve",
    description: "Return the full original text previously stored by compress, given its hash.",
    inputSchema: {
      type: "object",
      properties: { hash: { type: "string" } },
      required: ["hash"],
    },
  },
];

function text(s: string) {
  return { content: [{ type: "text", text: s }] };
}

async function main(): Promise<void> {
  const projectRoot = findRoot();
  const server = new Server(
    { name: "packmind", version: pkgVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (!isInitialized(projectRoot)) {
      return text("PackMind is not initialized in this project. Run `packmind init`.");
    }
    const a = (req.params.arguments ?? {}) as Record<string, any>;
    try {
      const ctx = makeContext(projectRoot);
      switch (req.params.name) {
        case "recall":
          return text(await toolRecall(ctx, String(a.query ?? "")));
        case "remember":
          return text(toolRemember(ctx, String(a.note ?? ""), a.kind));
        case "record_solution":
          return text(toolRecordSolution(ctx, { error: String(a.error ?? ""), cause: a.cause, fix: a.fix, file: a.file, tags: a.tags }));
        case "record_evidence":
          return text(toolRecordEvidence(ctx, { check: String(a.check ?? ""), detail: a.detail, session_id: a.session_id }));
        case "project_map":
          return text(toolProjectMap(ctx, a.filter));
        case "usage_report":
          return text(toolUsageReport(ctx));
        case "insights":
          return text(toolInsights(ctx));
        case "handoff":
          return text(toolHandoff(ctx, a.action === "set" ? "set" : "get", a.content));
        case "debt":
          return text(toolDebt(ctx));
        case "review":
          return text(toolReview(ctx, a.base));
        case "compress":
          return text(toolCompress(ctx, String(a.content ?? ""), a.kind));
        case "retrieve":
          return text(toolRetrieve(ctx, String(a.hash ?? "")));
        default:
          return text(`Unknown tool: ${req.params.name}`);
      }
    } catch (err) {
      return text(`PackMind tool error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  await server.connect(new StdioServerTransport());
}

export function runMcpServer(): Promise<void> {
  return main();
}
