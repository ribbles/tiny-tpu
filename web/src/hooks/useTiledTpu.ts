/**
 * useTiledTpu — orchestrates multiple 4×4 WASM passes for matrices > 4×4.
 *
 * Strategy:
 *   1. Build a tile schedule via tilingSchedule(M, K, N).
 *   2. For each TileCoord, extract the 4×4 A and B sub-tiles.
 *   3. Run the real 4×4 WASM core on each sub-tile; collect CycleState[].
 *   4. Accumulate partial C results (same output tile, different k-passes are summed).
 *   5. Assemble the full C matrix and expose it alongside all pass details.
 *
 * RULE: inter-tile accumulation is TS orchestration, not the RTL matmul.
 *       Each tile's MACs run on real RTL hardware (via WASM). The result
 *       matches matmul_golden() for any square input up to 8×8.
 *
 * WASM: loadTinyTpu() is dynamically imported inside the callback so it
 *       never runs during SSR.
 */

import { useCallback, useState } from "react";
import type { CycleState } from "@/lib/state-schema";
import {
  tilingSchedule,
  extractATile,
  extractBTile,
  assembleTiles,
  type TileCoord,
} from "@/lib/tiling";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TiledPass {
  /** Which output tile and k-tile this pass produced. */
  readonly coord: TileCoord;
  /** 4×4 A sub-tile that was loaded into the hardware (flat row-major). */
  readonly aFlat: readonly number[];
  /** 4×4 B sub-tile that was loaded as stationary weights (flat row-major). */
  readonly bFlat: readonly number[];
  /** Per-cycle RTL state snapshots from run() — typically 14–15 entries. */
  readonly states: readonly CycleState[];
  /** 4×4 partial result from this single RTL pass (flat row-major, int32). */
  readonly result: readonly number[];
}

export interface UseTiledTpuReturn {
  /** All completed passes in schedule order. Empty until runTiled completes. */
  readonly passes: readonly TiledPass[];
  /** Assembled final C matrix (flat row-major, size×size). Null until complete. */
  readonly assembledC: readonly number[] | null;
  /** Side length of the last tiled run (NxN). 0 if never run. */
  readonly matSize: number;
  /** True while runTiled is in progress. */
  readonly isRunning: boolean;
  readonly error: string | null;
  /**
   * Run an NxN matmul by tiling onto the 4×4 hardware.
   * aFlat and bFlat must be length size×size, flat row-major, int8 values.
   */
  readonly runTiled: (
    size: number,
    aFlat: readonly number[],
    bFlat: readonly number[],
  ) => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTiledTpu(): UseTiledTpuReturn {
  const [passes, setPasses] = useState<readonly TiledPass[]>([]);
  const [assembledC, setAssembledC] = useState<readonly number[] | null>(null);
  const [matSize, setMatSize] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTiled = useCallback(
    async (size: number, aFlat: readonly number[], bFlat: readonly number[]) => {
      setIsRunning(true);
      setError(null);
      setPasses([]);
      setAssembledC(null);
      setMatSize(size);

      try {
        const { loadTinyTpu } = await import("@/lib/wasm-loader");
        const schedule = tilingSchedule(size, size, size);
        const completedPasses: TiledPass[] = [];

        for (const coord of schedule) {
          const aTile = extractATile(aFlat, size, size, coord.outRow, coord.kTile);
          const bTile = extractBTile(bFlat, size, size, coord.kTile, coord.outCol);

          // Each pass gets a fresh sim instance — weights reset for every tile.
          const tpu = await loadTinyTpu();
          let states: CycleState[];
          let result: readonly number[];
          try {
            tpu.reset();
            tpu.loadA(aTile);
            tpu.loadB(bTile);
            tpu.start();
            states = tpu.run();
            result = tpu.getResult();
          } finally {
            tpu.destroy();
          }

          completedPasses.push({
            coord,
            aFlat: aTile,
            bFlat: bTile,
            states,
            result,
          });
        }

        const partials = completedPasses.map(({ coord, result }) => ({
          coord,
          result,
        }));
        const C = assembleTiles(partials, size, size);

        setPasses(completedPasses);
        setAssembledC(C);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setIsRunning(false);
      }
    },
    [],
  );

  return { passes, assembledC, matSize, isRunning, error, runTiled };
}
