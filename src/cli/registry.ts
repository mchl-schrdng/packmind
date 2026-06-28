import * as fs from "node:fs";
import * as path from "node:path";
import { userRoot } from "../util/platform.js";
import { toPosix } from "../util/paths.js";
import { readJsonOr, writeJson } from "../util/fs-atomic.js";

export interface RegistryEntry {
  root: string;
  name: string;
  registeredAt: string;
  version: string;
}

function registryPath(): string {
  return path.join(userRoot(), "registry.json");
}
function norm(root: string): string {
  return toPosix(path.resolve(root));
}

export function readRegistry(): RegistryEntry[] {
  const list = readJsonOr<RegistryEntry[]>(registryPath(), []);
  return Array.isArray(list) ? list : [];
}

export function registerProject(root: string, version: string): void {
  const existing = readRegistry();
  const prior = existing.find((e) => norm(e.root) === norm(root));
  const kept = existing.filter((e) => norm(e.root) !== norm(root));
  kept.push({
    root: norm(root),
    name: path.basename(path.resolve(root)),
    registeredAt: prior?.registeredAt ?? new Date().toISOString(),
    version,
  });
  writeJson(registryPath(), kept);
}

export function pruneRegistry(): RegistryEntry[] {
  const kept = readRegistry().filter((e) => fs.existsSync(path.join(e.root, ".packmind")));
  writeJson(registryPath(), kept);
  return kept;
}
