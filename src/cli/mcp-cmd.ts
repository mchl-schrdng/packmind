import { runMcpServer } from "../mcp/server.js";

/** Start the PackMind MCP server over stdio (invoked by Claude Code via .mcp.json). */
export async function runMcp(): Promise<void> {
  await runMcpServer();
}
