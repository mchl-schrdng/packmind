import * as path from "node:path";
import {
  requireState,
  projectRoot,
  confineToRoot,
  parseInput,
  readStdin,
  sessionRawKey,
  readSessionFor,
  recordChangeCandidate,
  requestReconcile,
} from "./runtime.js";

const DIRECT_WRITE = new Set(["Write", "Edit", "MultiEdit"]);

/**
 * After a batch of (possibly parallel) tool calls resolves, coalesce direct
 * writes into change candidates and flag a reconcile when anything that can
 * mutate the project off-tool (Bash, file-writing MCP tools, notebooks, agents,
 * unknown tools) ran. Inspects tool_name/tool_input only - never the (possibly
 * large) tool_response. Never blocks. The Stop reconcile is authoritative.
 */
async function main(): Promise<void> {
  requireState();
  const input = parseInput(await readStdin());
  const rawKey = sessionRawKey(input);
  if (!rawKey) process.exit(0);
  const session = readSessionFor(rawKey);
  if (!session) process.exit(0);

  const root = projectRoot();
  const at = new Date().toISOString();
  const calls = Array.isArray(input.tool_calls) ? input.tool_calls : [];
  let needReconcile = false;

  for (const c of calls) {
    const name = typeof c?.tool_name === "string" ? c.tool_name : "";
    if (DIRECT_WRITE.has(name)) {
      const fp = typeof c?.tool_input?.file_path === "string" ? c.tool_input.file_path : "";
      if (fp && confineToRoot(root, fp) !== null) {
        const rel = path.relative(root, path.resolve(root, fp)).split(path.sep).join("/");
        recordChangeCandidate(root, session, { path: rel, kind: "modify" }, "post-tool", at, [name]);
      }
    } else if (name) {
      // Bash / MCP writes / notebooks / agents / unknown may mutate the project.
      needReconcile = true;
    }
  }

  if (needReconcile) requestReconcile(root, session);
}

main().catch(() => process.exit(0));
