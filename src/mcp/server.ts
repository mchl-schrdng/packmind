import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { findRoot } from "../state/project.js";
import { pkgVersion } from "../cli/locate.js";
import {
  makeContext,
  isInitialized,
  toolRemember,
  toolRecordSolution,
  toolHandoff,
} from "./tools.js";

const TOOLS = [
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
    const a = (req.params.arguments ?? {}) as Record<string, any>;
    try {
      const ctx = makeContext(projectRoot);
      switch (req.params.name) {
        case "remember":
          return text(toolRemember(ctx, String(a.note ?? ""), a.kind));
        case "record_solution":
          return text(toolRecordSolution(ctx, { error: String(a.error ?? ""), cause: a.cause, fix: a.fix, file: a.file, tags: a.tags }));
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
