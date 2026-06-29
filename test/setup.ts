import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";

// Hermetic tests: never touch the real ~/.packmind. Point PACKMIND_HOME at a
// throwaway dir so snapshots/registry write there instead.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "packmind-home-"));
process.env.PACKMIND_HOME = home;
