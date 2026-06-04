/**
 * wasm-loader.ts - browser-only loader for the TinyTPU WASM module.
 *
 * RULE: loadTinyTpu() must only be called from the browser.
 * It throws immediately if window is undefined. Always call inside useEffect
 * or a client:only="react" island - never at module top level in SSR paths.
 */

import type { CycleState } from "./state-schema";

// ---------------------------------------------------------------------------
// Raw embind interface - mirrors TinyTpuSim in wasm/harness.cpp + bindings.cpp
// ---------------------------------------------------------------------------

interface RawSim {
  reset(): void;
  /** flat row-major int8[16]; values outside int8 range are truncated */
  loadA(flat: number[]): void;
  loadB(flat: number[]): void;
  /** Pulses hardware start signal; transitions FSM IDLE → LOAD_WEIGHTS */
  start(): void;
  /** Advance one clock cycle; returns a CycleState-shaped JS object */
  step(): unknown;
  /** Run until done fires + 1 extra cycle; returns CycleState[] */
  run(): unknown;
  /** Flat row-major int32[16] result after run() completes */
  getResult(): unknown;
  getCycleCount(): number;
  /** Release Emscripten heap allocation */
  delete(): void;
}

interface RawModule {
  TinyTpuSim: new () => RawSim;
}

// ---------------------------------------------------------------------------
// Public typed wrapper
// ---------------------------------------------------------------------------

export interface TinyTpuWrapper {
  reset(): void;
  /** flat row-major int8[16]; values outside int8 range are truncated */
  loadA(flat: readonly number[]): void;
  loadB(flat: readonly number[]): void;
  /** Pulses hardware start signal; transitions FSM IDLE → LOAD_WEIGHTS */
  start(): void;
  /** Returns a typed CycleState snapshot for this clock cycle */
  step(): CycleState;
  /** Runs the full matmul; returns all CycleState snapshots */
  run(): CycleState[];
  /** Returns the flat 4×4 result matrix (row-major, int32) after run() */
  getResult(): readonly number[];
  getCycleCount(): number;
  /** Must be called when done to free Emscripten heap memory */
  destroy(): void;
}

// Module singleton - reused across multiple TinyTpuWrapper instances
let _module: RawModule | null = null;

export async function loadTinyTpu(): Promise<TinyTpuWrapper> {
  if (typeof window === "undefined") {
    throw new Error("loadTinyTpu must only be called in the browser, not during SSR");
  }

  if (_module === null) {
    // /tiny_tpu.mjs lives in public/ - served from the web root at runtime,
    // declared external in astro.config.mjs rollupOptions.
    //
    // Vite 6 blocks direct dynamic imports of public/ files even with
    // @vite-ignore. Building the URL at runtime via import.meta.env.BASE_URL
    // prevents the vite:import-analysis plugin from seeing a literal public/
    // path, while keeping the correct URL ("/tiny_tpu.mjs") at runtime.
    const wasmUrl = (import.meta.env.BASE_URL as string) + "tiny_tpu.mjs";
    const { default: factory } = (await import(/* @vite-ignore */ wasmUrl)) as {
      default: (opts?: Record<string, unknown>) => Promise<RawModule>;
    };
    _module = await factory();
  }

  const sim = new _module.TinyTpuSim();

  return {
    reset() {
      sim.reset();
    },
    loadA(flat) {
      sim.loadA(flat as number[]);
    },
    loadB(flat) {
      sim.loadB(flat as number[]);
    },
    start() {
      sim.start();
    },
    step() {
      return sim.step() as CycleState;
    },
    run() {
      return sim.run() as CycleState[];
    },
    getResult() {
      return sim.getResult() as number[];
    },
    getCycleCount() {
      return sim.getCycleCount();
    },
    destroy() {
      sim.delete();
    },
  };
}
