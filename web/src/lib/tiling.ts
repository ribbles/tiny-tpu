/**
 * tiling.ts — pure math for tiling a large matmul onto the 4×4 hardware.
 *
 * Tiling strategy: row-major output tiles, accumulating over k-tiles.
 *
 * For C = A·B where A is (M,K) and B is (K,N):
 *   - Split into TILE_SIZE×TILE_SIZE sub-problems
 *   - C[oi,oj] += A_tile[oi,k] · B_tile[k,oj]  for each k-tile
 *
 * For an 8×8 matmul on the 4×4 array:
 *   tM=2, tK=2, tN=2 → 2×2×2 = 8 RTL passes total.
 *
 * RULE: inter-tile accumulation is TS orchestration, not the matmul.
 * Each tile's MACs run on real RTL. The rule is that each RTL core
 * starts from psum=0 and produces its partial C tile.
 *
 * No React, no WASM imports here — pure data manipulation.
 */

/** Physical array dimension. Must match the RTL 4×4 hardware. */
export const TILE_SIZE = 4 as const;

/** Identifies one tile pass in the schedule. */
export interface TileCoord {
  readonly outRow: number;  // output tile row index (0-based)
  readonly outCol: number;  // output tile col index (0-based)
  readonly kTile: number;   // inner-dimension (K) tile index (0-based)
}

/** Number of tiles needed to cover a dimension of length `dim`. */
export function numTiles(dim: number): number {
  return Math.ceil(dim / TILE_SIZE);
}

/**
 * Build the ordered list of tile passes for a (M,K)×(K,N) matmul.
 *
 * Order: row-major output tiles, then k-accumulation inside each output tile.
 * The caller runs these passes in order to accumulate the correct final C.
 */
export function tilingSchedule(M: number, K: number, N: number): readonly TileCoord[] {
  const schedule: TileCoord[] = [];
  const tM = numTiles(M);
  const tK = numTiles(K);
  const tN = numTiles(N);
  for (let oi = 0; oi < tM; oi++) {
    for (let oj = 0; oj < tN; oj++) {
      for (let k = 0; k < tK; k++) {
        schedule.push({ outRow: oi, outCol: oj, kTile: k });
      }
    }
  }
  return schedule;
}

/**
 * Extract the 4×4 sub-tile of A at position (rowTile, kTile).
 * Rows: A[rowTile*4 .. (rowTile+1)*4)
 * Cols: A[kTile*4  .. (kTile+1)*4)
 * Out-of-bounds elements are zero-padded.
 */
export function extractATile(
  aFlat: readonly number[],
  M: number,
  K: number,
  rowTile: number,
  kTile: number,
): readonly number[] {
  const tile = new Array<number>(TILE_SIZE * TILE_SIZE).fill(0);
  for (let r = 0; r < TILE_SIZE; r++) {
    for (let c = 0; c < TILE_SIZE; c++) {
      const mr = rowTile * TILE_SIZE + r;
      const mc = kTile * TILE_SIZE + c;
      if (mr < M && mc < K) {
        tile[r * TILE_SIZE + c] = aFlat[mr * K + mc] ?? 0;
      }
    }
  }
  return tile;
}

/**
 * Extract the 4×4 sub-tile of B at position (kTile, colTile).
 * Rows: B[kTile*4  .. (kTile+1)*4)
 * Cols: B[colTile*4 .. (colTile+1)*4)
 * Out-of-bounds elements are zero-padded.
 */
export function extractBTile(
  bFlat: readonly number[],
  K: number,
  N: number,
  kTile: number,
  colTile: number,
): readonly number[] {
  const tile = new Array<number>(TILE_SIZE * TILE_SIZE).fill(0);
  for (let r = 0; r < TILE_SIZE; r++) {
    for (let c = 0; c < TILE_SIZE; c++) {
      const mr = kTile * TILE_SIZE + r;
      const mc = colTile * TILE_SIZE + c;
      if (mr < K && mc < N) {
        tile[r * TILE_SIZE + c] = bFlat[mr * N + mc] ?? 0;
      }
    }
  }
  return tile;
}

/**
 * Assemble the final C matrix from completed tile partial results.
 *
 * Each `partial.result` is a 4×4 flat array from one RTL pass.
 * Same output-tile passes are summed (k-accumulation).
 */
export function assembleTiles(
  partials: ReadonlyArray<{
    readonly coord: TileCoord;
    readonly result: readonly number[];
  }>,
  M: number,
  N: number,
): readonly number[] {
  const C = new Array<number>(M * N).fill(0);
  for (const { coord, result } of partials) {
    const rowOff = coord.outRow * TILE_SIZE;
    const colOff = coord.outCol * TILE_SIZE;
    for (let r = 0; r < TILE_SIZE; r++) {
      for (let c = 0; c < TILE_SIZE; c++) {
        const mr = rowOff + r;
        const mc = colOff + c;
        if (mr < M && mc < N) {
          C[mr * N + mc] = (C[mr * N + mc] ?? 0) + (result[r * TILE_SIZE + c] ?? 0);
        }
      }
    }
  }
  return C;
}

/** Clamp a value to the signed int8 range [−128, 127]. */
export function clampInt8(v: number): number {
  return Math.max(-128, Math.min(127, Math.round(v)));
}

/**
 * Flatten a 2-D number[][] to a 1-D row-major array.
 * Provides type safety at the boundary between MatrixInput and the hooks.
 */
export function flattenMatrix(mat: readonly (readonly number[])[]): readonly number[] {
  return mat.flatMap((row) => row);
}

/** Build an N×N identity matrix (int values). */
export function identityMatrix(n: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)),
  );
}

/** Build an N×N zero matrix. */
export function zeroMatrix(n: number): number[][] {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
}
