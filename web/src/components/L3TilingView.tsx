/**
 * L3TilingView — visualizes how a large matrix multiply is tiled onto the 4×4 array.
 *
 * For an N×N input (N > 4), the matmul is split into TILE_SIZE×TILE_SIZE sub-problems:
 *   - tM × tN output tiles, each accumulating tK partial results from real RTL passes.
 *   - For an 8×8 run: tM=tN=tK=2 → 8 RTL passes total.
 *
 * Shows:
 *   - A schedule grid: each cell is an output tile (C[oi][oj]);
 *     click to inspect its RTL passes.
 *   - Pass list for the selected output tile (k-tile accumulation).
 *   - A small PEGrid + cycle step nav for the selected pass.
 *   - The assembled C result matrix.
 *
 * RULE: inter-tile accumulation (summing k-tile partial results) is TS orchestration,
 * not the matmul. Each tile's MACs run on the real 4×4 RTL hardware via WASM.
 */

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PEGrid } from "@/components/PEGrid";
import type { TiledPass } from "@/hooks/useTiledTpu";
import { numTiles, TILE_SIZE } from "@/lib/tiling";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface L3TilingViewProps {
  passes: readonly TiledPass[];
  assembledC: readonly number[] | null;
  matSize: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function L3TilingView({ passes, assembledC, matSize }: L3TilingViewProps) {
  const [selOutRow, setSelOutRow] = useState(0);
  const [selOutCol, setSelOutCol] = useState(0);
  const [cycleIdx, setCycleIdx] = useState(0);
  const [selKPass, setSelKPass] = useState(0);

  if (matSize === 0 || passes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">L3 Tiling</p>
        <p className="text-xs text-muted-foreground max-w-xs mx-auto">
          Run a matrix larger than 4×4 to see tiling in action. Try{" "}
          <strong>8×8</strong> — it splits into 8 real RTL passes.
        </p>
      </div>
    );
  }

  const tM = numTiles(matSize);
  const tN = numTiles(matSize);
  const tK = numTiles(matSize);

  // Passes for the selected output tile
  const tilePasses = passes.filter(
    (p) => p.coord.outRow === selOutRow && p.coord.outCol === selOutCol,
  );

  const selectedPass = tilePasses[selKPass] ?? passes[0];

  const maxCycle = selectedPass ? selectedPass.states.length - 1 : 0;
  const currentState = selectedPass?.states[Math.min(cycleIdx, maxCycle)];

  function selectTile(oi: number, oj: number) {
    setSelOutRow(oi);
    setSelOutCol(oj);
    setSelKPass(0);
    setCycleIdx(0);
  }

  // Color for schedule grid cell
  function tileColor(oi: number, oj: number): string {
    const cellPasses = passes.filter(
      (p) => p.coord.outRow === oi && p.coord.outCol === oj,
    );
    if (cellPasses.length === 0) return "var(--pe-idle)";
    // Fully accumulated = all k-tiles done
    if (cellPasses.length === tK) return "var(--pe-result)";
    if (cellPasses.length > 0) return "var(--pe-weight-loaded)";
    return "var(--pe-idle)";
  }

  return (
    <div className="space-y-5">
      {/* Schedule grid + pass selector */}
      <div className="flex flex-wrap gap-6 items-start">
        {/* Output tile schedule grid */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Output tile schedule ({tM}×{tN} tiles · {tK} k-pass{tK > 1 ? "es" : ""} each)
          </p>
          <div
            className="inline-grid gap-2"
            style={{ gridTemplateColumns: `repeat(${tN}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: tM }, (_, oi) =>
              Array.from({ length: tN }, (__, oj) => {
                const isSelected = oi === selOutRow && oj === selOutCol;
                const kDone = passes.filter(
                  (p) => p.coord.outRow === oi && p.coord.outCol === oj,
                ).length;
                return (
                  <button
                    key={`${oi}-${oj}`}
                    onClick={() => selectTile(oi, oj)}
                    className={`
                      h-16 w-16 rounded-lg border-2 text-xs font-mono flex flex-col items-center justify-center gap-0.5
                      transition-all
                      ${isSelected ? "border-primary scale-105" : "border-transparent hover:border-border"}
                    `}
                    style={{ background: tileColor(oi, oj) }}
                    aria-label={`Output tile C[${oi}][${oj}], ${kDone}/${tK} k-passes done`}
                    aria-pressed={isSelected}
                  >
                    <span className="text-current/80">C[{oi}][{oj}]</span>
                    <span className="text-current/60">{kDone}/{tK} k</span>
                  </button>
                );
              }),
            )}
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: "var(--pe-idle)" }}
              />
              Not started
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: "var(--pe-weight-loaded)" }}
              />
              Partial
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: "var(--pe-result)" }}
              />
              Done
            </span>
          </div>
        </div>

        {/* K-pass selector for selected output tile */}
        {tilePasses.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              C[{selOutRow}][{selOutCol}] k-passes
            </p>
            <div className="flex flex-col gap-1.5">
              {tilePasses.map((tp, ki) => (
                <button
                  key={ki}
                  onClick={() => { setSelKPass(ki); setCycleIdx(0); }}
                  className={`
                    rounded px-3 py-1.5 text-xs font-mono text-left transition-colors
                    ${ki === selKPass
                      ? "bg-primary/20 border border-primary/50 text-foreground"
                      : "hover:bg-muted border border-transparent text-muted-foreground"
                    }
                  `}
                >
                  <span className="font-semibold">Pass {ki + 1}:</span>{" "}
                  k={tp.coord.kTile} · A[{tp.coord.outRow}][{tp.coord.kTile}] × B[{tp.coord.kTile}][{tp.coord.outCol}]
                </button>
              ))}
              {tilePasses.length > 1 && (
                <p className="text-xs text-muted-foreground/70 pl-1">
                  C[{selOutRow}][{selOutCol}] = sum of {tilePasses.length} RTL passes
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selected pass: PEGrid + cycle navigation */}
      {selectedPass && currentState && (
        <div className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              <span className="font-semibold">
                Pass {passes.indexOf(selectedPass) + 1} of {passes.length}
              </span>
              <span className="ml-2 text-muted-foreground text-xs font-mono">
                C[{selectedPass.coord.outRow}][{selectedPass.coord.outCol}] · k={selectedPass.coord.kTile}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCycleIdx((i) => Math.max(0, i - 1))}
                disabled={cycleIdx === 0}
                aria-label="Previous cycle"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs font-mono text-muted-foreground px-2 min-w-[80px] text-center">
                cycle {cycleIdx + 1} / {maxCycle + 1}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCycleIdx((i) => Math.min(maxCycle, i + 1))}
                disabled={cycleIdx >= maxCycle}
                aria-label="Next cycle"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-start">
            <PEGrid state={currentState} />

            {/* Tile info */}
            <div className="space-y-3 min-w-0 flex-1">
              <div className="space-y-1 text-xs font-mono">
                <p className="text-muted-foreground">A sub-tile (this pass):</p>
                <div
                  className="inline-grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${TILE_SIZE}, minmax(0, 1fr))` }}
                >
                  {selectedPass.aFlat.map((v, i) => (
                    <div
                      key={i}
                      className="h-7 w-9 rounded border border-border/40 bg-muted/40 flex items-center justify-center text-foreground"
                    >
                      {v}
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1 text-xs font-mono">
                <p className="text-muted-foreground">B sub-tile (stationary weights):</p>
                <div
                  className="inline-grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${TILE_SIZE}, minmax(0, 1fr))` }}
                >
                  {selectedPass.bFlat.map((v, i) => (
                    <div
                      key={i}
                      className="h-7 w-9 rounded border border-border/40 bg-muted/40 flex items-center justify-center text-foreground"
                    >
                      {v}
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-1 text-xs font-mono">
                <p className="text-muted-foreground">Partial result (this pass):</p>
                <div
                  className="inline-grid gap-1"
                  style={{ gridTemplateColumns: `repeat(${TILE_SIZE}, minmax(0, 1fr))` }}
                >
                  {selectedPass.result.map((v, i) => (
                    <div
                      key={i}
                      className="h-7 w-10 rounded border border-[oklch(0.738_0.18_158.8)]/40 bg-[oklch(0.738_0.18_158.8)]/5 flex items-center justify-center text-foreground"
                    >
                      {v}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assembled C matrix */}
      {assembledC && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Assembled C = A × B ({matSize}×{matSize}) — all {passes.length} RTL passes accumulated
          </p>
          <div
            className="inline-grid gap-1"
            style={{ gridTemplateColumns: `repeat(${matSize}, minmax(0, 1fr))` }}
          >
            {assembledC.map((v, i) => (
              <div
                key={i}
                className="h-9 min-w-[3rem] px-2 rounded border border-[oklch(0.738_0.18_158.8)]/40 bg-[oklch(0.738_0.18_158.8)]/10 flex items-center justify-center text-xs font-mono text-foreground"
              >
                {v}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
