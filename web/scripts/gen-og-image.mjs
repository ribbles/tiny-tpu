/**
 * Generates web/public/og-image.png (1200×630) for OpenGraph / Twitter cards.
 * Run: node web/scripts/gen-og-image.mjs
 *
 * Uses sharp (already a pnpm dep via Astro) to rasterize an SVG.
 * Font stack: Liberation fonts (system) → sensible fallbacks.
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

// ── Colours from the site's design tokens ─────────────────────────────────────
const BG       = "#0d0d0d";
const SURFACE  = "#161616";
const LIME     = "#b4f73b";
const CYAN     = "#22d3ee";
const FG       = "#ededed";
const MUTED    = "#737373";
const BORDER   = "#2a2a2a";

// ── Layout ────────────────────────────────────────────────────────────────────
const W = 1200, H = 630;
const PAD = 72;

// ── PE grid (right side) ──────────────────────────────────────────────────────
const GRID_X   = 700;
const GRID_Y   = H / 2 - 165;
const CELL     = 72;
const CELL_GAP = 10;

function peCell(row, col) {
  const x = GRID_X + col * (CELL + CELL_GAP);
  const y = GRID_Y + row * (CELL + CELL_GAP);
  const isDiag    = row === col;
  const isLoading = row === col + 1;
  const fill = isDiag
    ? `color-mix(in oklch, ${LIME} 9%, ${SURFACE})`
    : isLoading
    ? SURFACE
    : SURFACE;
  const stroke = isDiag
    ? LIME
    : isLoading
    ? CYAN
    : BORDER;
  const opacity = isDiag ? "1" : isLoading ? "0.7" : "0.4";
  return `
    <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="5"
      fill="${isDiag ? '#1a2a0a' : isLoading ? '#0d1a1f' : SURFACE}"
      stroke="${stroke}" stroke-width="${isDiag ? 1.5 : 1}"
      opacity="${opacity}"/>
    <text x="${x + 7}" y="${y + 14}" font-size="8"
      font-family="Liberation Mono,DejaVu Sans Mono,monospace"
      fill="${isDiag ? LIME : isLoading ? CYAN : MUTED}"
      opacity="${isDiag ? '1' : '0.6'}">w=${(row * 4 + col + 1) % 10}</text>
    <text x="${x + CELL / 2}" y="${y + CELL / 2 + 7}" font-size="15"
      text-anchor="middle" font-weight="bold"
      font-family="Liberation Mono,DejaVu Sans Mono,monospace"
      fill="${isDiag ? LIME : MUTED}"
      opacity="${isDiag ? '1' : '0.35'}">${isDiag ? Math.round(Math.random() * 80 + 40) : ''}</text>
  `;
}

const peCells = Array.from({ length: 16 }, (_, i) =>
  peCell(Math.floor(i / 4), i % 4)
).join("\n");

// ── Column/row labels ─────────────────────────────────────────────────────────
const colLabels = [0, 1, 2, 3].map(c =>
  `<text x="${GRID_X + c * (CELL + CELL_GAP) + CELL / 2}" y="${GRID_Y - 12}"
    text-anchor="middle" font-size="11" fill="${MUTED}" opacity="0.5"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace">C${c}</text>`
).join("\n");

const rowLabels = [0, 1, 2, 3].map(r =>
  `<text x="${GRID_X - 12}" y="${GRID_Y + r * (CELL + CELL_GAP) + CELL / 2 + 4}"
    text-anchor="end" font-size="11" fill="${MUTED}" opacity="0.5"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace">R${r}</text>`
).join("\n");

// ── SVG ───────────────────────────────────────────────────────────────────────
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- Background -->
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <!-- Subtle grid texture -->
  <defs>
    <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.8" fill="${BORDER}"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#dots)" opacity="0.35"/>

  <!-- Left accent bar -->
  <rect x="0" y="0" width="3" height="${H}" fill="${LIME}"/>

  <!-- Badge -->
  <rect x="${PAD}" y="${PAD}" width="110" height="24" rx="12"
    fill="none" stroke="${LIME}" stroke-width="1" opacity="0.5"/>
  <circle cx="${PAD + 16}" cy="${PAD + 12}" r="4" fill="${LIME}" opacity="0.9"/>
  <text x="${PAD + 28}" y="${PAD + 16}"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace"
    font-size="10" fill="${LIME}" letter-spacing="1.5">LIVE RTL</text>

  <!-- TinyTPU wordmark -->
  <text x="${PAD}" y="${PAD + 78}"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace"
    font-size="18" fill="${MUTED}" letter-spacing="2">TinyTPU</text>

  <!-- Main headline -->
  <text x="${PAD}" y="${PAD + 148}"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace"
    font-size="62" font-weight="bold" fill="${FG}" letter-spacing="-2">A TPU you can</text>
  <text x="${PAD}" y="${PAD + 220}"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace"
    font-size="62" font-weight="bold" fill="${LIME}" letter-spacing="-2" font-style="italic">watch run.</text>

  <!-- Sub text -->
  <text x="${PAD}" y="${PAD + 284}"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace"
    font-size="20" fill="${MUTED}" letter-spacing="0">Real SystemVerilog compiled to WASM</text>
  <text x="${PAD}" y="${PAD + 312}"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace"
    font-size="20" fill="${MUTED}" letter-spacing="0">running live in your browser</text>

  <!-- Pipeline tags -->
  ${["rtl/*.sv", "verilator --cc", "em++ -O3", "React island"].map((tag, i) => `
  <rect x="${PAD + i * 138}" y="${H - PAD - 38}" width="${tag.length * 8 + 18}" height="26" rx="4"
    fill="${SURFACE}" stroke="${BORDER}" stroke-width="1"/>
  <text x="${PAD + i * 138 + 9}" y="${H - PAD - 20}"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace"
    font-size="11" fill="${i === 0 ? LIME : MUTED}">${tag}</text>
  `).join("\n")}

  <!-- Right: PE grid label -->
  <text x="${GRID_X + (4 * (CELL + CELL_GAP) - CELL_GAP) / 2}" y="${GRID_Y - 36}"
    text-anchor="middle" font-size="11"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace"
    fill="${MUTED}" opacity="0.5" letter-spacing="2">4×4 SYSTOLIC ARRAY</text>

  <!-- PE column / row labels -->
  ${colLabels}
  ${rowLabels}

  <!-- PE cells -->
  ${peCells}

  <!-- Flow arrow labels -->
  <text x="${GRID_X + 2 * (CELL + CELL_GAP) + CELL / 2}" y="${GRID_Y + 4 * (CELL + CELL_GAP) + 20}"
    text-anchor="middle" font-size="11"
    font-family="Liberation Mono,DejaVu Sans Mono,monospace"
    fill="${CYAN}" opacity="0.6">↓ results drain south</text>

  <!-- Vertical divider -->
  <line x1="640" y1="60" x2="640" y2="${H - 60}"
    stroke="${BORDER}" stroke-width="1" opacity="0.5"/>
</svg>`;

// ── Write + convert ───────────────────────────────────────────────────────────

// Write SVG for debugging
writeFileSync(join(publicDir, "og-image.svg"), svg, "utf-8");
console.log("✔ Wrote og-image.svg");

// Import sharp from pnpm store
const require = createRequire(import.meta.url);
const sharpPath = join(
  __dirname, "..", "node_modules", ".pnpm",
  "sharp@0.34.5", "node_modules", "sharp"
);
let sharp;
try {
  sharp = require(sharpPath);
} catch {
  // fallback to normal require
  sharp = require("sharp");
}

await sharp(Buffer.from(svg))
  .png()
  .toFile(join(publicDir, "og-image.png"));

console.log("✔ Wrote og-image.png (1200×630)");
