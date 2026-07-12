import * as path from "node:path";
import { brain } from "../state/files.js";
import { readJsonOr, writeJson } from "../util/fs-atomic.js";
import { walkProject } from "../state/walk.js";
import { isGitRepo, gitStatus, type PorcelainStatus } from "./git.js";
import { isEligiblePath, fingerprint } from "./eligible.js";
import { computeNetChanges, reconcileGit } from "./reconcile.js";
import type { Config } from "../state/schema.js";
import type { NetChange } from "./types.js";

const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 128) || "unknown";

/**
 * Immutable per-incarnation baseline. For git projects it stores the porcelain
 * status at session start plus fingerprints of the already-dirty/untracked
 * eligible paths (so pre-existing dirt isn't attributed later). For non-git it
 * stores a full eligible-file fingerprint manifest (bounded by walkProject).
 */
export interface BaselineV1 {
  version: 1;
  incarnationId: string;
  sessionId?: string;
  root: string;
  cwd?: string;
  createdAt: string;
  kind: "git" | "manifest";
  status?: PorcelainStatus;
  hashes: Record<string, string>;
}

export function baselineFile(root: string, incarnationId: string): string {
  return path.join(brain(root).changeBaselineDir, `${safeId(incarnationId)}.json`);
}

export function readBaseline(root: string, incarnationId: string): BaselineV1 | null {
  return readJsonOr<BaselineV1 | null>(baselineFile(root, incarnationId), null);
}

export function writeBaseline(root: string, b: BaselineV1): void {
  writeJson(baselineFile(root, b.incarnationId), b);
}

export function createBaseline(
  root: string,
  config: Config,
  meta: { incarnationId: string; sessionId?: string; cwd?: string },
): BaselineV1 {
  const common = {
    version: 1 as const,
    incarnationId: meta.incarnationId,
    sessionId: meta.sessionId,
    root,
    cwd: meta.cwd,
    createdAt: new Date().toISOString(),
  };

  if (isGitRepo(root)) {
    const status = gitStatus(root) ?? { changed: [], renames: [] };
    const hashes: Record<string, string> = {};
    const paths = new Set<string>();
    for (const e of status.changed) paths.add(e.path);
    for (const r of status.renames) {
      paths.add(r.from);
      paths.add(r.to);
    }
    for (const rel of paths) {
      if (!isEligiblePath(root, rel, config)) continue;
      const fp = fingerprint(path.join(root, rel));
      if (fp) hashes[rel] = fp;
    }
    return { ...common, kind: "git", status, hashes };
  }

  const hashes: Record<string, string> = {};
  for (const { abs, rel } of walkProject(root, config)) {
    const fp = fingerprint(abs);
    if (fp) hashes[rel] = fp;
  }
  return { ...common, kind: "manifest", hashes };
}

/**
 * Reconcile the current filesystem against a baseline into net changes. Uses
 * git status diffing for git projects and full-manifest comparison otherwise,
 * then filters both endpoints through the eligibility rules.
 */
export function reconcileSession(root: string, config: Config, baseline: BaselineV1): NetChange[] {
  let net: NetChange[];
  if (baseline.kind === "git") {
    const current = gitStatus(root) ?? { changed: [], renames: [] };
    const overlap: Record<string, string> = {};
    for (const rel of Object.keys(baseline.hashes)) {
      const fp = fingerprint(path.join(root, rel));
      if (fp) overlap[rel] = fp;
    }
    net = reconcileGit(
      { status: baseline.status ?? { changed: [], renames: [] }, hashes: baseline.hashes },
      { status: current, hashes: overlap },
    );
  } else {
    const currentHashes: Record<string, string> = {};
    for (const { abs, rel } of walkProject(root, config)) {
      const fp = fingerprint(abs);
      if (fp) currentHashes[rel] = fp;
    }
    net = computeNetChanges({ hashes: baseline.hashes }, { hashes: currentHashes });
  }
  return net.filter(
    (c) => isEligiblePath(root, c.path, config) && (!c.previousPath || isEligiblePath(root, c.previousPath, config)),
  );
}
