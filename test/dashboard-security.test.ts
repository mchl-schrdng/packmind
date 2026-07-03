import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { startDashboard, type DashboardHandle } from "../src/dashboard/server.js";

/**
 * DNS-rebinding defense: the dashboard serves its token-bearing page and API
 * only to requests whose Host header names a loopback address. A page on
 * attacker.com that rebinds DNS to 127.0.0.1 sends `Host: attacker.com` and
 * must be rejected before the token is ever handed out.
 */
function get(port: number, pathname: string, host: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers: { host } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("dashboard host-header validation", () => {
  let root: string;
  let handle: DashboardHandle;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dashsec-"));
    fs.mkdirSync(path.join(root, ".packmind"), { recursive: true });
    handle = await startDashboard(root, 7914);
  });
  afterAll(() => {
    handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("rejects a foreign Host header with 403 (does not leak the page/token)", async () => {
    const res = await get(handle.port, "/", "attacker.com");
    expect(res.status).toBe(403);
  });

  it("serves the page for a loopback Host", async () => {
    const res = await get(handle.port, "/", `127.0.0.1:${handle.port}`);
    expect(res.status).toBe(200);
  });

  it("sets a frame-ancestors CSP on responses (clickjacking defense)", async () => {
    const res = await get(handle.port, "/", "localhost");
    expect(res.status).toBe(200);
    expect(String(res.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
  });
});
