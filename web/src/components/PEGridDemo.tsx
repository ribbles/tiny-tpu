/**
 * PEGridDemo - test island for P7-T1 verification.
 * Renders three hardcoded CycleState snapshots to exercise every PE color state:
 *   1. LOAD_WEIGHTS cycle - all PEs show weight-loaded (blue)
 *   2. STREAM cycle - some PEs active (lime), others weight-loaded (blue)
 *   3. DONE cycle - all contributing PEs show result (emerald)
 *
 * Usage: <PEGridDemo client:only="react" />
 */

import { useState } from "react";
import { PEGrid } from "./PEGrid";
import type { CycleState } from "@/lib/state-schema";

// ─── Hardcoded test states ─────────────────────────────────────────────────────

const LOAD_WEIGHTS_STATE: CycleState = {
  cycle: 2,
  fsmState: "LOAD_WEIGHTS",
  pes: Array.from({ length: 16 }, (_, idx) => ({
    row: Math.floor(idx / 4),
    col: idx % 4,
    weight: idx + 1,
    actIn: 0,
    psum: 0,
    active: false,
  })),
  westInputs: [0, 0, 0, 0],
  southOutputs: [
    { col: 0, value: 0, valid: false },
    { col: 1, value: 0, valid: false },
    { col: 2, value: 0, valid: false },
    { col: 3, value: 0, valid: false },
  ],
  done: false,
};

const STREAM_STATE: CycleState = {
  cycle: 7,
  fsmState: "STREAM",
  pes: [
    { row: 0, col: 0, weight: 9, actIn: 1, psum: 9,  active: true  },
    { row: 0, col: 1, weight: 8, actIn: 1, psum: 8,  active: true  },
    { row: 0, col: 2, weight: 7, actIn: 0, psum: 0,  active: false },
    { row: 0, col: 3, weight: 0, actIn: 0, psum: 0,  active: false },
    { row: 1, col: 0, weight: 6, actIn: 4, psum: 24, active: true  },
    { row: 1, col: 1, weight: 5, actIn: 1, psum: 13, active: true  },
    { row: 1, col: 2, weight: 4, actIn: 0, psum: 0,  active: false },
    { row: 1, col: 3, weight: 0, actIn: 0, psum: 0,  active: false },
    { row: 2, col: 0, weight: 3, actIn: 7, psum: 21, active: true  },
    { row: 2, col: 1, weight: 2, actIn: 4, psum: 8,  active: true  },
    { row: 2, col: 2, weight: 1, actIn: 1, psum: 1,  active: true  },
    { row: 2, col: 3, weight: 0, actIn: 0, psum: 0,  active: false },
    { row: 3, col: 0, weight: 0, actIn: 0, psum: 0,  active: false },
    { row: 3, col: 1, weight: 0, actIn: 7, psum: 0,  active: false },
    { row: 3, col: 2, weight: 0, actIn: 4, psum: 0,  active: false },
    { row: 3, col: 3, weight: 0, actIn: 1, psum: 0,  active: false },
  ],
  westInputs: [0, 0, 0, 7],
  southOutputs: [
    { col: 0, value: 0, valid: false },
    { col: 1, value: 0, valid: false },
    { col: 2, value: 0, valid: false },
    { col: 3, value: 0, valid: false },
  ],
  done: false,
};

const DONE_STATE: CycleState = {
  cycle: 13,
  fsmState: "DONE",
  pes: [
    { row: 0, col: 0, weight: 9, actIn: 0, psum: 30,  active: false },
    { row: 0, col: 1, weight: 8, actIn: 0, psum: 24,  active: false },
    { row: 0, col: 2, weight: 7, actIn: 0, psum: 18,  active: false },
    { row: 0, col: 3, weight: 0, actIn: 0, psum: 0,   active: false },
    { row: 1, col: 0, weight: 6, actIn: 0, psum: 84,  active: false },
    { row: 1, col: 1, weight: 5, actIn: 0, psum: 69,  active: false },
    { row: 1, col: 2, weight: 4, actIn: 0, psum: 54,  active: false },
    { row: 1, col: 3, weight: 0, actIn: 0, psum: 0,   active: false },
    { row: 2, col: 0, weight: 3, actIn: 0, psum: 138, active: false },
    { row: 2, col: 1, weight: 2, actIn: 0, psum: 114, active: false },
    { row: 2, col: 2, weight: 1, actIn: 0, psum: 90,  active: false },
    { row: 2, col: 3, weight: 0, actIn: 0, psum: 0,   active: false },
    { row: 3, col: 0, weight: 0, actIn: 0, psum: 0,   active: false },
    { row: 3, col: 1, weight: 0, actIn: 0, psum: 0,   active: false },
    { row: 3, col: 2, weight: 0, actIn: 0, psum: 0,   active: false },
    { row: 3, col: 3, weight: 0, actIn: 0, psum: 0,   active: false },
  ],
  westInputs: [0, 0, 0, 0],
  southOutputs: [
    { col: 0, value: 138, valid: true  },
    { col: 1, value: 114, valid: true  },
    { col: 2, value: 90,  valid: true  },
    { col: 3, value: 0,   valid: false },
  ],
  done: true,
};

const SNAPSHOTS: { label: string; state: CycleState }[] = [
  { label: "LOAD_WEIGHTS (cycle 2)",  state: LOAD_WEIGHTS_STATE },
  { label: "STREAM (cycle 7)",        state: STREAM_STATE },
  { label: "DONE (cycle 13)",         state: DONE_STATE },
];

// ─── Demo island ──────────────────────────────────────────────────────────────

export default function PEGridDemo() {
  const [idx, setIdx] = useState(0);
  const snap = SNAPSHOTS[idx];
  if (!snap) return null;

  return (
    <div className="space-y-6">
      {/* Snapshot selector */}
      <div className="flex flex-wrap gap-2">
        {SNAPSHOTS.map((s, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={[
              "rounded border px-3 py-1 text-xs font-mono transition-colors",
              i === idx
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
            ].join(" ")}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* FSM state badge */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
          FSM
        </span>
        <span className="rounded border border-border px-2 py-0.5 text-xs font-mono text-foreground">
          {snap.state.fsmState}
        </span>
        <span className="text-xs font-mono text-muted-foreground">
          cycle {snap.state.cycle}
        </span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs font-mono">
        {[
          { color: "var(--pe-idle)",         label: "idle" },
          { color: "var(--pe-weight-loaded)", label: "weight loaded" },
          { color: "var(--pe-active)",        label: "MAC active" },
          { color: "var(--pe-result)",        label: "result valid" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm border border-border"
              style={{ backgroundColor: color }}
            />
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <PEGrid state={snap.state} />
    </div>
  );
}
