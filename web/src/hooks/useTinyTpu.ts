/**
 * useTinyTpu — owns the WASM simulator and the full per-cycle playback engine.
 *
 * Lifecycle:
 *   1. On mount, loads the WASM module and runs the default matrices immediately.
 *   2. Stores the full CycleState[] trace returned by sim.run().
 *   3. Exposes transport controls (play/pause/step/reset/scrub/speed) that
 *      advance `cycleIdx` through the stored trace.
 *
 * rAF loop notes:
 *   - The tick callback reads only refs (never stale-closed state).
 *   - Cancels rAF on unmount and pauses on `visibilitychange`.
 *   - `lastAdvanceRef` is seeded with `performance.now()` on play so the first
 *     cycle-advance waits a full interval (users see the current frame briefly).
 *
 * WASM notes:
 *   - `loadTinyTpu()` is imported dynamically inside a useEffect so it never
 *     runs during SSR.
 *   - The `TinyTpuWrapper` is destroyed after `run()` completes; all state lives
 *     in the CycleState[] array from that point.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CycleState } from "@/lib/state-schema";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Milliseconds between cycle advances at 1× speed. */
const BASE_INTERVAL_MS = 800;

export const SPEED_OPTIONS = [0.5, 1, 2, 4] as const;
export type SpeedOption = (typeof SPEED_OPTIONS)[number];

/** Default 3×3 matmul zero-padded to the 4×4 hardware width. */
export const DEFAULT_A_FLAT = [
  1, 2, 3, 0,
  4, 5, 6, 0,
  7, 8, 9, 0,
  0, 0, 0, 0,
] as const;

export const DEFAULT_B_FLAT = [
  9, 8, 7, 0,
  6, 5, 4, 0,
  3, 2, 1, 0,
  0, 0, 0, 0,
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseTinyTpuReturn {
  /** Full simulation trace. Empty until isLoaded. */
  readonly states: readonly CycleState[];
  /** Index into states[] currently displayed (0-based). */
  readonly cycleIdx: number;
  readonly isPlaying: boolean;
  /** True once the WASM has loaded and the first run() completed. */
  readonly isLoaded: boolean;
  readonly error: string | null;
  readonly speed: SpeedOption;

  readonly play: () => void;
  readonly pause: () => void;
  /** Toggle play/pause. */
  readonly toggle: () => void;
  /** Advance one cycle (pauses first). */
  readonly stepForward: () => void;
  /** Rewind one cycle (pauses first). */
  readonly stepBack: () => void;
  /** Return to cycle 0 and pause. */
  readonly reset: () => void;
  /** Jump to a specific cycle index (pauses first). */
  readonly scrubTo: (idx: number) => void;
  readonly setSpeed: (speed: SpeedOption) => void;
  /** Re-run the simulation with new matrices (resets playback). */
  readonly runWith: (
    aFlat: readonly number[],
    bFlat: readonly number[],
  ) => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTinyTpu(): UseTinyTpuReturn {
  // ── Rendered state ─────────────────────────────────────────────────────────
  const [states, setStates] = useState<readonly CycleState[]>([]);
  const [cycleIdx, setCycleIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speed, setSpeedState] = useState<SpeedOption>(1);

  // ── Refs for rAF callback (avoid stale closures) ───────────────────────────
  const statesRef = useRef<readonly CycleState[]>([]);
  const cycleIdxRef = useRef(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef<SpeedOption>(1);
  const rafRef = useRef(0);
  const lastAdvanceRef = useRef(0);

  // ── rAF tick ───────────────────────────────────────────────────────────────
  const tick = useCallback((timestamp: number) => {
    if (!isPlayingRef.current) return;

    const interval = BASE_INTERVAL_MS / speedRef.current;
    if (timestamp - lastAdvanceRef.current >= interval) {
      lastAdvanceRef.current = timestamp;
      const next = cycleIdxRef.current + 1;
      if (next >= statesRef.current.length) {
        // Reached end of trace — stop playback, stay on last frame
        isPlayingRef.current = false;
        setIsPlaying(false);
        return;
      }
      cycleIdxRef.current = next;
      setCycleIdx(next);
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Transport actions ──────────────────────────────────────────────────────

  const pause = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const play = useCallback(() => {
    if (statesRef.current.length === 0) return;
    // If at end, restart from the beginning
    if (cycleIdxRef.current >= statesRef.current.length - 1) {
      cycleIdxRef.current = 0;
      setCycleIdx(0);
    }
    isPlayingRef.current = true;
    setIsPlaying(true);
    // Seed to now so the first advance waits a full interval (not immediate)
    lastAdvanceRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const toggle = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [play, pause]);

  const stepForward = useCallback(() => {
    pause();
    const max = Math.max(0, statesRef.current.length - 1);
    const next = Math.min(cycleIdxRef.current + 1, max);
    cycleIdxRef.current = next;
    setCycleIdx(next);
  }, [pause]);

  const stepBack = useCallback(() => {
    pause();
    const prev = Math.max(cycleIdxRef.current - 1, 0);
    cycleIdxRef.current = prev;
    setCycleIdx(prev);
  }, [pause]);

  const reset = useCallback(() => {
    pause();
    cycleIdxRef.current = 0;
    setCycleIdx(0);
  }, [pause]);

  const scrubTo = useCallback(
    (idx: number) => {
      pause();
      const clamped = Math.max(
        0,
        Math.min(idx, Math.max(0, statesRef.current.length - 1)),
      );
      cycleIdxRef.current = clamped;
      setCycleIdx(clamped);
    },
    [pause],
  );

  const setSpeed = useCallback((s: SpeedOption) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);

  // ── Simulation runner ──────────────────────────────────────────────────────

  const runWith = useCallback(
    async (aFlat: readonly number[], bFlat: readonly number[]) => {
      pause();
      setIsLoaded(false);
      setError(null);
      setStates([]);
      statesRef.current = [];
      cycleIdxRef.current = 0;
      setCycleIdx(0);

      try {
        // Dynamic import keeps this out of SSR paths entirely
        const { loadTinyTpu } = await import("@/lib/wasm-loader");
        const tpu = await loadTinyTpu();
        try {
          tpu.reset();
          tpu.loadA(aFlat);
          tpu.loadB(bFlat);
          tpu.start();
          const allStates = tpu.run();
          statesRef.current = allStates;
          setStates(allStates);
          setIsLoaded(true);
        } finally {
          tpu.destroy();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [pause],
  );

  // ── Effects ────────────────────────────────────────────────────────────────

  // Initial simulation run
  useEffect(() => {
    void runWith(DEFAULT_A_FLAT, DEFAULT_B_FLAT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause on tab hide (rAF already stops when hidden, but this ensures state sync)
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") pause();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pause]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    states,
    cycleIdx,
    isPlaying,
    isLoaded,
    error,
    speed,
    play,
    pause,
    toggle,
    stepForward,
    stepBack,
    reset,
    scrubTo,
    setSpeed,
    runWith,
  };
}
