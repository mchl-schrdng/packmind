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
  toolProjectMap,
  toolUsageReport,
  toolInsights,
  toolHandoff,
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
        kind: { type: "string", enum: ["Preferences", "Decisions", "Never Do", "Notes"] },
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
    const ctx = makeContext(projectRoot);
    const a = (req.params.arguments ?? {}) as Record<string, any>;
    try {
      switch (req.params.name) {
        case "recall":
          return text(await toolRecall(ctx, String(a.query ?? "")));
        case "remember":
          return text(toolRemember(ctx, String(a.note ?? ""), a.kind));
        case "record_solution":
          return text(toolRecordSolution(ctx, { error: String(a.error ?? ""), cause: a.cause, fix: a.fix, file: a.file, tags: a.tags }));
        case "project_map":
          return text(toolProjectMap(ctx, a.filter));
        case "usage_report":
          return text(toolUsageReport(ctx));
        case "insights":
          return text(toolInsights(ctx));
        case "handoff":
          return text(toolHandoff(ctx, a.action === "set" ? "set" : "get", a.content));
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
