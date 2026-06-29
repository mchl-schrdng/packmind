#!/usr/bin/env node
// Generate a self-hosted coverage badge (badges/coverage.svg) from Vitest's
// coverage-summary.json. Zero dependencies — builds a shields-style flat SVG.
import * as fs from "node:fs";
import * as path from "node:path";

const summaryPath = path.resolve("coverage/coverage-summary.json");
let pct = 0;
try {
  const total = JSON.parse(fs.readFileSync(summaryPath, "utf8")).total;
  pct = Math.round((total.lines?.pct ?? 0) * 10) / 10;
} catch {
  console.error("coverage-summary.json not found — run `pnpm test:coverage` first.");
  process.exit(1);
}

function color(p) {
  if (p >= 90) return "#3fb950"; // green
  if (p >= 75) return "#a3c93a";
  if (p >= 60) return "#d29922"; // amber
  if (p >= 40) return "#e0823d";
  return "#e5534b"; // red
}

const label = "coverage";
const value = `${pct}%`;
// Approximate text widths (6.1px/char at 11px font) for a tidy layout.
const lw = Math.round(label.length * 6.1) + 10;
const vw = Math.round(value.length * 6.1) + 12;
const total = lw + vw;
const c = color(pct);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${c}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${lw / 2}" y="14">${label}</text>
    <text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${lw + vw / 2}" y="14">${value}</text>
  </g>
</svg>
`;

fs.mkdirSync("badges", { recursive: true });
fs.writeFileSync("badges/coverage.svg", svg);
console.log(`coverage badge: ${value}`);
