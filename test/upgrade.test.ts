import { describe, it, expect } from "vitest";
import { compareVersions, detectPackageManager, upgradeCommand } from "../src/cli/upgrade-cmd.js";

describe("compareVersions", () => {
  it("orders versions numerically (not lexically)", () => {
    expect(compareVersions("0.8.1", "0.8.2")).toBe(-1);
    expect(compareVersions("0.8.2", "0.8.1")).toBe(1);
    expect(compareVersions("0.8.1", "0.8.1")).toBe(0);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1); // 9 < 10 numerically
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
  });
  it("ignores a pre-release suffix", () => {
    expect(compareVersions("0.8.2-rc.1", "0.8.2")).toBe(0);
  });
});

describe("detectPackageManager", () => {
  it("recognizes pnpm, yarn, and defaults to npm", () => {
    expect(detectPackageManager("/Users/x/Library/pnpm/global/5/node_modules/packmind/dist/cli/upgrade-cmd.js")).toBe("pnpm");
    expect(detectPackageManager("/home/x/.yarn/global/node_modules/packmind/dist/cli/upgrade-cmd.js")).toBe("yarn");
    expect(detectPackageManager("/usr/local/lib/node_modules/packmind/dist/cli/upgrade-cmd.js")).toBe("npm");
    expect(detectPackageManager("C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\packmind\\dist\\cli\\upgrade-cmd.js")).toBe("npm");
  });
});

describe("upgradeCommand", () => {
  it("builds the install-latest command per package manager", () => {
    expect(upgradeCommand("npm")).toEqual(["npm", "install", "-g", "packmind@latest"]);
    expect(upgradeCommand("pnpm")).toEqual(["pnpm", "add", "-g", "packmind@latest"]);
    expect(upgradeCommand("yarn")).toEqual(["yarn", "global", "add", "packmind@latest"]);
  });
});
