/**
 * L1SinglePE — focuses on one Processing Element, teaching the MAC operation.
 *
 * Shows:
 *   - A row/column picker to select which PE to inspect (0–3 × 0–3)
 *   - An enlarged PE cell with live values (weight, actIn, psum)
 *   - The MAC equation updating per cycle: psum = psum_prev + weight × actIn
 *   - A per-cycle psum history table (last N cycles)
 *
 * Pure presentational — receives states[] and cycleIdx from the parent.
 */

import { useState } from "react";
import type { CycleState, PEState } from "@/lib/state-schema";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface L1SinglePEProps {
  states: readonly CycleState[];
  cycleIdx: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPE(state: CycleState, row: number, col: number): PEState {
  return state.pes[row * 4 + col] ?? {
    row,
    col,
    weight: 0,
    actIn: 0,
    psum: 0,
    active: false,
  };
}

function fmtSigned(v: number): string {
  return v >= 0 ? `+${v}` : String(v);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function L1SinglePE({ states, cycleIdx }: L1SinglePEProps) {
  const [selRow, setSelRow] = useState(0);
  const [selCol, setSelCol] = useState(0);

  const current = states[cycleIdx];
  const pe = current ? getPE(current, selRow, selCol) : null;

  // psum history: last 8 cycles
  const historyStart = Math.max(0, cycleIdx - 7);
  const history = states
    .slice(historyStart, cycleIdx + 1)
    .map((s, i) => ({ cycle: historyStart + i, pe: getPE(s, selRow, selCol), fsm: s.fsmState }));

  const prevPe =
    cycleIdx > 0 && states[cycleIdx - 1]
      ? getPE(states[cycleIdx - 1]!, selRow, selCol)
      : null;

  // Color for the large PE cell
  function cellColor(): string {
    if (!pe) return "var(--pe-idle)";
    if (pe.active) return "var(--pe-active)";
    const fsm = current?.fsmState;
    if ((fsm === "DRAIN" || fsm === "DONE") && pe.psum !== 0) return "var(--pe-result)";
    if (pe.weight !== 0) return "var(--pe-weight-loaded)";
    return "var(--pe-idle)";
  }

  return (
    <div className="space-y-4">
      {/* PE selector */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Row</span>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((r) => (
              <button
                key={r}
                onClick={() => setSelRow(r)}
                className={`h-7 w-7 rounded text-xs font-mono transition-colors ${
                  r === selRow
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
                aria-pressed={r === selRow}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Col</span>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((c) => (
              <button
                key={c}
                onClick={() => setSelCol(c)}
                className={`h-7 w-7 rounded text-xs font-mono transition-colors ${
                  c === selCol
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
                aria-pressed={c === selCol}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-2 text-sm text-muted-foreground font-mono">
          PE[{selRow}][{selCol}]
        </div>
      </div>

      <div className="flex flex-wrap gap-6 items-start">
        {/* Large PE cell */}
        <div
          className="flex-shrink-0 w-40 h-40 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors duration-300 border-2 border-border"
          style={{ background: cellColor() }}
          aria-label={`PE row ${selRow} col ${selCol}`}
        >
          <span className="text-xs font-mono text-current/70">
            w = {pe?.weight ?? 0}
          </span>
          <span className="text-3xl font-bold font-mono text-current tabular-nums">
            {pe?.psum ?? 0}
          </span>
          <span className="text-xs font-mono text-current/70">
            actIn = {pe?.actIn ?? 0}
          </span>
        </div>

        {/* MAC equation */}
        <div className="space-y-3 flex-1 min-w-0">
          <p className="text-sm font-semibold">MAC Operation</p>
          {pe && current ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 font-mono text-sm">
              <div className="text-muted-foreground text-xs">
                Every clock cycle when active:
              </div>
              <div className="text-foreground">
                psum<sub>out</sub> = psum<sub>in</sub> + weight × actIn
              </div>
              <div className="border-t border-border/50 pt-2 space-y-1 text-xs">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24">weight</span>
                  <span className="text-foreground">{pe.weight}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24">actIn</span>
                  <span className="text-foreground">{pe.actIn}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24">psum_in</span>
                  <span className="text-foreground">{prevPe?.psum ?? 0}</span>
                </div>
                <div className="flex gap-2 font-semibold border-t border-border/30 pt-1">
                  <span className="text-muted-foreground w-24">psum_out</span>
                  <span className="text-foreground">{pe.psum}</span>
                  {pe.active && (
                    <span className="text-muted-foreground/60 font-normal">
                      = {prevPe?.psum ?? 0} {fmtSigned(pe.weight * pe.actIn)}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                FSM: {current.fsmState} · cycle {current.cycle}
                {pe.active && (
                  <span className="ml-2 text-[oklch(0.898_0.231_131.3)]">
                    ● MAC firing
                  </span>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          )}
        </div>
      </div>

      {/* psum history */}
      {history.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">psum history (last {history.length} cycles)</p>
          <div className="overflow-x-auto">
            <table className="text-xs font-mono border-collapse w-full">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="px-2 py-1 text-left font-normal border-b border-border">cycle</th>
                  <th className="px-2 py-1 text-left font-normal border-b border-border">fsm</th>
                  <th className="px-2 py-1 text-right font-normal border-b border-border">weight</th>
                  <th className="px-2 py-1 text-right font-normal border-b border-border">actIn</th>
                  <th className="px-2 py-1 text-right font-normal border-b border-border">psum</th>
                  <th className="px-2 py-1 text-left font-normal border-b border-border">mac?</th>
                </tr>
              </thead>
              <tbody>
                {history.map(({ cycle, pe: hPe, fsm }, i) => (
                  <tr
                    key={cycle}
                    className={
                      i === history.length - 1
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground"
                    }
                  >
                    <td className="px-2 py-0.5">{cycle}</td>
                    <td className="px-2 py-0.5">{fsm}</td>
                    <td className="px-2 py-0.5 text-right">{hPe.weight}</td>
                    <td className="px-2 py-0.5 text-right">{hPe.actIn}</td>
                    <td className="px-2 py-0.5 text-right">{hPe.psum}</td>
                    <td className="px-2 py-0.5">
                      {hPe.active ? (
                        <span className="text-[oklch(0.898_0.231_131.3)]">●</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
