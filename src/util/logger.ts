type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let threshold: Level = (process.env.PACKMIND_LOG as Level) || "info";

export function setLogLevel(level: Level): void {
  threshold = level;
}

function line(level: Level, msg: string): void {
  if (RANK[level] < RANK[threshold]) return;
  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  stream.write(`[packmind] ${msg}\n`);
}

export const log = {
  debug: (m: string) => line("debug", m),
  info: (m: string) => line("info", m),
  warn: (m: string) => line("warn", m),
  error: (m: string) => line("error", m),
};
