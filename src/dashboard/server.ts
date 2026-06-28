import * as http from "node:http";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { URL } from "node:url";
import { brain } from "../state/files.js";
import { loadConfig, type Config } from "../state/schema.js";
import { readTextOr, readJsonOr } from "../util/fs-atomic.js";
import { parseMap } from "../state/formats.js";
import { readLedger, totalCost } from "../cost/ledger.js";
import { VectorStore } from "../recall/store.js";
import { recall } from "../recall/indexer.js";
import { LocalEmbedder } from "../recall/embedder.js";
import { TEMPLATES_DIR } from "../cli/locate.js";

export interface DashboardHandle {
  url: string;
  port: number;
  token: string;
  close: () => void;
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
  // The logo is public (no token) — used for the header badge and favicon.
  if (url.pathname === "/logo.svg") {
    return send(res, 200, "image/svg+xml", readTextOr(`${TEMPLATES_DIR}/logo.svg`));
  }
  // Everything under /api requires the token.
  if (url.pathname.startsWith("/api/")) {
    if (token !== ctx.token) return json(res, 401, { error: "unauthorized" });
    try {
      if (url.pathname === "/api/overview") return json(res, 200, overview(ctx));
      if (url.pathname === "/api/map") return json(res, 200, mapEntries(ctx));
      if (url.pathname === "/api/solutions")
        return json(res, 200, readJsonOr(brain(ctx.projectRoot).solutions, []));
      if (url.pathname === "/api/journal")
        return json(res, 200, { text: readTextOr(brain(ctx.projectRoot).journal).split(/\r?\n/).slice(-200).join("\n") });
      if (url.pathname === "/api/knowledge")
        return json(res, 200, { text: readTextOr(brain(ctx.projectRoot).knowledge) });
      if (url.pathname === "/api/recall") {
        const q = url.searchParams.get("q") ?? "";
        if (!q.trim()) return json(res, 200, { hits: [] });
        const embedder = new LocalEmbedder(ctx.config.recall.embedModel);
        const hits = await recall(ctx.projectRoot, ctx.config, embedder, q);
        return json(res, 200, { hits });
      }
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  send(res, 404, "text/plain", "not found");
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
      // SECURITY: bind to loopback only — never exposed to the network.
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
