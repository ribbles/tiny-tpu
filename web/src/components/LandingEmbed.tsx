/**
 * LandingEmbed — compact auto-looping mini-visualizer for the landing page.
 *
 * Uses useTinyTpu (the same hook as the full /app Visualizer) so WASM loading
 * is guaranteed to work. Adds a continuous loop on top: once isLoaded flips
 * to true the animation plays to the DONE cycle then restarts from 0.
 */

import { useEffect } from "react";
import { useTinyTpu } from "@/hooks/useTinyTpu";
import { PEGrid } from "@/components/PEGrid";

const FSM_LABELS: Record<string, string> = {
  IDLE: "Idle",
  LOAD_WEIGHTS: "Loading weights",
  STREAM: "Streaming activations",
  DRAIN: "Draining results",
  DONE: "Done",
};

// ── Loading skeleton ──────────────────────────────────────────────────────────
// Mirrors PEGrid's exact SVG layout (same CELL/GAP/offsets) so the page is
// visually "complete" at FCP (~0.8 s) instead of showing an empty spinner for
// the 7 s it takes WASM to download. This is the primary fix for Speed Index.

const SK_CELL = 88;
const SK_GAP = 10;
const SK_N = 4;
const SK_WEST_W = 70;
const SK_TOP_H = 40;
const SK_SOUTH_H = 64;
const SK_GRID = SK_N * SK_CELL + (SK_N - 1) * SK_GAP; // 382
const SK_W = SK_WEST_W + SK_GRID + 12; // 464
const SK_H = SK_TOP_H + SK_GRID + SK_SOUTH_H; // 486

function Skeleton() {
  const cells = Array.from({ length: SK_N }, (_, row) =>
    Array.from({ length: SK_N }, (_, col) => ({
      x: SK_WEST_W + col * (SK_CELL + SK_GAP),
      y: SK_TOP_H + row * (SK_CELL + SK_GAP),
      delay: ((row + col) % 4) * 0.25,
    })),
  ).flat();

  return (
    <div style={{ minHeight: 420 }} aria-busy="true" aria-label="Loading simulator">
      <svg
        viewBox={`0 0 ${SK_W} ${SK_H}`}
        style={{ width: "100%", maxWidth: SK_W, display: "block", margin: "0 auto" }}
        aria-hidden="true"
      >
        <defs>
          <style>{`
            @keyframes tpu-sk-pulse {
              0%,100%{opacity:.55} 50%{opacity:.9}
            }
            .tpu-sk { animation: tpu-sk-pulse 1.8s ease-in-out infinite; }
          `}</style>
        </defs>

        {/* 4×4 PE cells — same positions as the live PEGrid */}
        {cells.map(({ x, y, delay }, i) => (
          <rect
            key={i}
            className="tpu-sk"
            style={{ animationDelay: `${delay}s` }}
            x={x}
            y={y}
            width={SK_CELL}
            height={SK_CELL}
            rx={4}
            fill="var(--pe-idle)"
          />
        ))}

        {/* West-edge activation-input placeholders */}
        {Array.from({ length: SK_N }, (_, row) => {
          const cy = SK_TOP_H + row * (SK_CELL + SK_GAP) + SK_CELL / 2;
          return (
            <g key={row} opacity={0.25}>
              <circle cx={SK_WEST_W - 20} cy={cy} r={6} fill="var(--muted-foreground)" />
              <line
                x1={SK_WEST_W - 14}
                y1={cy}
                x2={SK_WEST_W - 3}
                y2={cy}
                stroke="var(--muted-foreground)"
                strokeWidth={1.5}
              />
            </g>
          );
        })}

        {/* Loading label — same vertical position as PEGrid south outputs */}
        <text
          x={SK_WEST_W + SK_GRID / 2}
          y={SK_TOP_H + SK_GRID + SK_SOUTH_H - 16}
          textAnchor="middle"
          fontFamily="var(--font-geist-mono, monospace)"
          fontSize={10}
          fill="var(--muted-foreground)"
          opacity={0.45}
        >
          Compiling RTL → WASM
        </text>
      </svg>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LandingEmbed() {
  const tpu = useTinyTpu();

  // Auto-start playing as soon as the initial load is done.
  // useTinyTpu deliberately does NOT auto-play on the initial load (the
  // user controls playback on /app), so we kick it off here.
  useEffect(() => {
    if (tpu.isLoaded && !tpu.isPlaying) {
      tpu.play();
    }
  }, [tpu.isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loop: when playback stops (DONE cycle reached), restart from 0.
  useEffect(() => {
    if (!tpu.isLoaded) return;
    if (!tpu.isPlaying && tpu.states.length > 0) {
      const timer = setTimeout(() => {
        tpu.reset();
        tpu.play();
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [tpu.isPlaying, tpu.isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (tpu.error) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 px-6"
        style={{ minHeight: 420, color: "var(--signal-amber)" }}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.1em]">
          Simulator failed to load
        </p>
        <p className="font-mono text-[10px] text-center opacity-60">
          {tpu.error}
        </p>
      </div>
    );
  }

  if (!tpu.isLoaded) {
    return <Skeleton />;
  }

  const currentState = tpu.states[tpu.cycleIdx];
  const fsmLabel =
    currentState != null
      ? (FSM_LABELS[currentState.fsmState] ?? currentState.fsmState)
      : null;

  return (
    <div className="flex flex-col" style={{ minHeight: 420 }}>
      {/* PEGrid */}
      <div className="flex-1 px-3 pt-4 pb-1 sm:px-5">
        {currentState != null && <PEGrid state={currentState} />}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-4 py-2.5 sm:px-5"
        style={{ borderTop: "1px solid var(--hairline)" }}
      >
        <div className="flex items-center gap-2">
          {fsmLabel != null && (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    currentState?.fsmState === "STREAM"
                      ? "var(--pe-active)"
                      : currentState?.fsmState === "DONE"
                        ? "var(--pe-result)"
                        : currentState?.fsmState === "LOAD_WEIGHTS"
                          ? "var(--pe-weight-loaded)"
                          : "var(--muted-foreground)",
                }}
              />
              <span
                className="font-mono text-[10px] font-medium uppercase tracking-[0.1em]"
                style={{ color: "var(--muted-foreground)" }}
              >
                {fsmLabel}
              </span>
            </span>
          )}
          {currentState != null && (
            <span
              className="font-mono text-[10px]"
              style={{ color: "var(--muted-foreground)", opacity: 0.5 }}
            >
              cycle {currentState.cycle}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={tpu.toggle}
          className="inline-flex items-center gap-1 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-opacity hover:opacity-80"
          style={{
            border: "1px solid var(--hairline-strong)",
            color: "var(--muted-foreground)",
          }}
          aria-label={tpu.isPlaying ? "Pause" : "Play"}
        >
          {tpu.isPlaying ? "⏸ Pause" : "▶ Play"}
        </button>
      </div>
    </div>
  );
}
