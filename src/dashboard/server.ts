import * as http from "node:http";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { URL } from "node:url";
import { brain } from "../state/files.js";
import { loadConfig, type Config } from "../state/schema.js";
import { readTextOr, readJsonOr, writeJson, writeText } from "../util/fs-atomic.js";
import { parseMap } from "../state/formats.js";
import { readLedger, totalCost } from "../cost/ledger.js";
import { computeInsights } from "../cost/insights.js";
import { VectorStore } from "../recall/store.js";
import { recall, indexSize } from "../recall/indexer.js";
import { LocalEmbedder } from "../recall/embedder.js";
import { DEFAULT_POLICY, validateRules, type Rule } from "../guard/policy.js";
import { applyConfigPatch, summarizeClaudeConfig, ALLOWED_CONFIG_KEYS } from "./config-api.js";
import { TEMPLATES_DIR } from "../cli/locate.js";
import * as path from "node:path";

export interface DashboardHandle {
  url: string;
  port: number;
  token: string;
  close: () => void;
}

/**
 * Tail of the journal for the dashboard, never cutting a session header off.
 * The client parser keys sessions on `## ` headers, so a naive last-N-lines
 * slice can orphan an active session's rows (header scrolled past the window)
 * and render the tab as empty. Back the start up to the most recent `## `
 * boundary so the parser always sees complete leading sessions.
 */
export function journalTail(text: string, maxLines = 200): string {
  const lines = text.split(/\r?\n/);
  let start = Math.max(0, lines.length - maxLines);
  while (start > 0 && !lines[start].startsWith("## ")) start--;
  return lines.slice(start).join("\n");
}

interface Ctx {
  projectRoot: string;
  config: Config;
  token: string;
}

function send(res: http.ServerResponse, code: number, type: string, body: string | Buffer): void {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}
function json(res: http.ServerResponse, code: number, value: unknown): void {
  send(res, code, "application/json", JSON.stringify(value));
}

function overview(ctx: Ctx) {
  const b = brain(ctx.projectRoot);
  const ledger = readLedger(ctx.projectRoot, ctx.config.model);
  const map = parseMap(readTextOr(b.map));
  let files = 0;
  for (const [, list] of map) files += list.length;
  const vectors = new VectorStore(b.vectors).size();
  return {
    project: ctx.projectRoot.split("/").pop(),
    model: ledger.model,
    files,
    vectors,
    totals: ledger.totals,
    cost: totalCost(ledger),
    sessions: ledger.sessions.slice(-30),
  };
}

function mapEntries(ctx: Ctx) {
  const out: Array<{ section: string; file: string; description: string; tokens: number; cost: number }> = [];
  for (const [section, list] of parseMap(readTextOr(brain(ctx.projectRoot).map))) {
    for (const e of list) out.push({ section, file: e.file, description: e.description, tokens: e.tokens, cost: e.cost ?? 0 });
  }
  return out.sort((a, b) => b.tokens - a.tokens);
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, ctx: Ctx, html: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const token = url.searchParams.get("token") ?? req.headers["x-packmind-token"];

  if (url.pathname === "/") {
    return send(res, 200, "text/html; charset=utf-8", html.replace("__TOKEN__", ctx.token));
  }
  // The logo is public (no token) - favicon uses logo.svg, the header uses the
  // dark-mode variant (light strokes) so it reads on the dark UI without a badge.
  if (url.pathname === "/logo.svg") {
    return send(res, 200, "image/svg+xml", readTextOr(`${TEMPLATES_DIR}/logo.svg`));
  }
  if (url.pathname === "/logo-dark.svg") {
    return send(res, 200, "image/svg+xml", readTextOr(`${TEMPLATES_DIR}/logo-dark.svg`));
  }
  // Everything under /api requires the token.
  if (url.pathname.startsWith("/api/")) {
    if (token !== ctx.token) return json(res, 401, { error: "unauthorized" });
    try {
      if (url.pathname === "/api/overview") return json(res, 200, overview(ctx));
      if (url.pathname === "/api/insights") return json(res, 200, computeInsights(ctx.projectRoot, ctx.config));
      if (url.pathname === "/api/map") return json(res, 200, mapEntries(ctx));
      if (url.pathname === "/api/solutions")
        return json(res, 200, readJsonOr(brain(ctx.projectRoot).solutions, []));
      if (url.pathname === "/api/journal")
        return json(res, 200, { text: journalTail(readTextOr(brain(ctx.projectRoot).journal)) });
      if (url.pathname === "/api/knowledge" && req.method !== "POST")
        return json(res, 200, { text: readTextOr(brain(ctx.projectRoot).knowledge) });
      if (url.pathname === "/api/recall") {
        const q = url.searchParams.get("q") ?? "";
        if (!q.trim()) return json(res, 200, { hits: [] });
        const embedder = new LocalEmbedder(ctx.config.recall.embedModel);
        const hits = await recall(ctx.projectRoot, ctx.config, embedder, q);
        return json(res, 200, { hits, indexed: indexSize(ctx.projectRoot, ctx.config) > 0 });
      }

      // ---- Config tab: view + edit the config PackMind owns -------------
      const b = brain(ctx.projectRoot);
      if (url.pathname === "/api/config") {
        if (req.method === "POST") {
          const patch = await readJsonBody(req);
          const { config, errors } = applyConfigPatch(readJsonOr(b.config, {}), patch);
          if (errors.length) return json(res, 400, { errors });
          writeJson(b.config, config);
          ctx.config = loadConfig(b.config); // refresh - the server reads this live
          return json(res, 200, { ok: true, config: ctx.config });
        }
        return json(res, 200, { config: loadConfig(b.config), editableKeys: ALLOWED_CONFIG_KEYS });
      }
      if (url.pathname === "/api/policy") {
        if (req.method === "POST") {
          const body = await readJsonBody(req);
          const rules = (body as { rules?: Rule[] })?.rules;
          if (!Array.isArray(rules)) return json(res, 400, { errors: ["body must be { rules: [...] }"] });
          const errors = validateRules(rules);
          if (errors.length) return json(res, 400, { errors });
          writeJson(b.policy, { version: 1, rules });
          return json(res, 200, { ok: true });
        }
        return json(res, 200, readJsonOr(b.policy, DEFAULT_POLICY));
      }
      if (url.pathname === "/api/knowledge" && req.method === "POST") {
        const body = await readJsonBody(req);
        const text = (body as { text?: string })?.text;
        if (typeof text !== "string") return json(res, 400, { errors: ["body must be { text: string }"] });
        writeText(b.knowledge, text);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/claude-config") {
        const settings = readJsonOr<unknown>(path.join(ctx.projectRoot, ctx.config.claude.settingsPath), {});
        const mcp = readJsonOr<unknown>(path.join(ctx.projectRoot, ".mcp.json"), {});
        return json(res, 200, summarizeClaudeConfig(settings, mcp));
      }
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  send(res, 404, "text/plain", "not found");
}

/** Read and JSON-parse a request body, capped to guard against abuse. */
function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) { reject(new Error("request body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function listenOnFreePort(server: http.Server, start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryListen = () => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port < start + 50) {
          port++;
          tryListen();
        } else {
          reject(err);
        }
      });
      // SECURITY: bind to loopback only - never exposed to the network.
      server.listen(port, "127.0.0.1", () => resolve(port));
    };
    tryListen();
  });
}

export async function startDashboard(projectRoot: string, preferredPort = 7878): Promise<DashboardHandle> {
  const config = loadConfig(brain(projectRoot).config);
  const token = crypto.randomBytes(16).toString("hex");
  const ctx: Ctx = { projectRoot, config, token };
  const html = fs.readFileSync(`${TEMPLATES_DIR}/dashboard.html`, "utf8");

  const server = http.createServer((req, res) => {
    handle(req, res, ctx, html).catch(() => send(res, 500, "text/plain", "error"));
  });
  const port = await listenOnFreePort(server, preferredPort);
  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    port,
    token,
    close: () => server.close(),
  };
}
