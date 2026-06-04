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

function Skeleton() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 animate-pulse"
      style={{ minHeight: 420 }}
      aria-busy="true"
    >
      <div
        className="h-6 w-6 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--signal-cyan)", borderTopColor: "transparent" }}
        role="status"
      />
      <p
        className="font-mono text-[11px] uppercase tracking-[0.12em]"
        style={{ color: "var(--signal-cyan)" }}
      >
        Compiling RTL → WASM
      </p>
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
