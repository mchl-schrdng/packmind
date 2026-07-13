import { stateFile } from "../util/paths.js";

/** Resolve the standard brain-file paths for a project. */
export function brain(projectRoot: string) {
  return {
    dir: stateFile(projectRoot),
    protocol: stateFile(projectRoot, "PACKMIND.md"),
    config: stateFile(projectRoot, "config.json"),
    knowledge: stateFile(projectRoot, "knowledge.md"),
    solutions: stateFile(projectRoot, "solutions.json"),
    handoff: stateFile(projectRoot, "handoff.md"),
    policy: stateFile(projectRoot, "policy.json"),
    effective: stateFile(projectRoot, "guard.effective.json"),
    hooksDir: stateFile(projectRoot, "hooks"),
  };
}
