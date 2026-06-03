# STATE_SCHEMA.md — TinyTPU Per-Cycle State Contract

> **Sync requirement:** This file and `web/src/lib/state-schema.ts` define the same
> contract from two angles (prose + types). They **must stay in sync**. Any field
> added, removed, or renamed here must be reflected in the TypeScript file, and vice
> versa.

---

## Overview

The C++ harness (`wasm/harness.cpp`) emits one `CycleState` object per clock cycle.
The React visualizer reads these objects to animate the systolic array. Nothing is
fabricated in JavaScript — every field maps directly to a hardware signal or a
documented derivation from hardware signals.

---

## CycleState

```json
{
  "cycle":       <int>,
  "fsmState":    <FsmState>,
  "pes":         <PEState[16]>,
  "westInputs":  <int[4]>,
  "southOutputs":<SouthOutput[4]>,
  "done":        <bool>
}
```

### `cycle` — `number` (non-negative integer)

Cycle index, starting at 0 on the cycle the `start` signal fires. Increments by 1
each clock tick until `done` is true.

---

### `fsmState` — `"IDLE" | "LOAD_WEIGHTS" | "STREAM" | "DRAIN" | "DONE"`

The controller FSM state for this cycle.

**Hardware mapping:** `dbg_fsm_state` (3-bit output of `tiny_tpu_top`), encoded by
the `controller.sv` enum:

| `dbg_fsm_state` | `fsmState` string  |
|-----------------|--------------------|
| `3'd0`          | `"IDLE"`           |
| `3'd1`          | `"LOAD_WEIGHTS"`   |
| `3'd2`          | `"STREAM"`         |
| `3'd3`          | `"DRAIN"`          |

**Derived "DONE":** The hardware FSM has no `DONE` state — after `DRAIN` it returns
to `IDLE`. The harness overrides `fsmState` to `"DONE"` on the cycle where `done`
is asserted (`done == 1`). On that cycle the hardware reads as `ST_DRAIN` transitioning
to `ST_IDLE`; `"DONE"` is a harness-level convenience for the visualizer.

---

### `pes` — `PEState[]` (16 entries, row-major)

One entry per processing element, ordered row-major: index `i*4 + j` is PE[row=i][col=j].

#### PEState fields

| Field    | Type      | Hardware source                                      |
|----------|-----------|------------------------------------------------------|
| `row`    | `number`  | Row index `i` (0–3)                                  |
| `col`    | `number`  | Column index `j` (0–3)                               |
| `weight` | `number`  | `dbg_weight[i][j]` — signed int8, stationary weight  |
| `actIn`  | `number`  | **Derived** — see note below                         |
| `psum`   | `number`  | `dbg_psum[i][j]` — signed int32, registered psum_out |
| `active` | `boolean` | `true` when `fsmState == "STREAM"` and `actIn != 0`  |

**`actIn` derivation (not a direct register read):**

The debug bus exposes `dbg_act[i][j]` which is `pe[i][j].act_out` — the *registered
output* of the activation passthrough, i.e., `act_in` from the *previous* cycle.
The actual activation *input* to PE[i][j] on the current cycle is:

```
actIn[i][j] = (j == 0) ? dbg_west[i]        // west-edge input for column 0
                        : dbg_act[i][j-1]    // act_out of the PE to the left
```

This derivation is performed in the C++ harness before populating `CycleState`.
`dbg_west[i]` is the `act_west[i]` signal driven by the controller this cycle.

---

### `westInputs` — `number[]` (4 entries)

`westInputs[i]` is the activation value entering the left edge of row `i` this cycle.

**Hardware source:** `dbg_west[i]` = `act_west[i]` from the controller. Signed int8
range (−128 to 127). Zero when the FSM is not in `STREAM` state or when row `i` is
outside its active skew window.

---

### `southOutputs` — `SouthOutput[]` (4 entries)

One entry per column. `southOutputs[j]` describes the value exiting the bottom of
column `j` this cycle.

#### SouthOutput fields

| Field   | Type      | Hardware source                                       |
|---------|-----------|-------------------------------------------------------|
| `col`   | `number`  | Column index `j` (0–3)                                |
| `value` | `number`  | `dbg_south[j]` — signed int32 psum leaving bottom row |
| `valid` | `boolean` | `true` when this column's output carries a final result element on this cycle |

**`valid` semantics:** The harness computes validity from the FSM state and internal
cycle counters. A south output is valid when the accumulated psum for a particular
output element `C[r][j]` has finished propagating and the harness captures it into
the result buffer. There is exactly one valid cycle per output element per column.

---

### `done` — `boolean`

`true` on the single cycle where the hardware `done` signal is asserted. At this
point all 16 output elements are captured in the result buffer and `fsmState` is
reported as `"DONE"`.

**Hardware source:** The registered `done` output of `tiny_tpu_top`. For N=4, this
fires 14 cycles after `start` (matching `golden.py`'s `expected_cycles()`).

---

## Full Example (cycle during STREAM, N=4)

```json
{
  "cycle": 6,
  "fsmState": "STREAM",
  "pes": [
    { "row": 0, "col": 0, "weight": 3, "actIn": 1, "psum": 12, "active": true },
    { "row": 0, "col": 1, "weight": 7, "actIn": 1, "psum": 7,  "active": true },
    ...
    { "row": 3, "col": 3, "weight": 2, "actIn": 0, "psum": 0,  "active": false }
  ],
  "westInputs": [1, 2, 0, 0],
  "southOutputs": [
    { "col": 0, "value": 12, "valid": false },
    { "col": 1, "value": 7,  "valid": false },
    { "col": 2, "value": 0,  "valid": false },
    { "col": 3, "value": 0,  "valid": false }
  ],
  "done": false
}
```

---

## FSM Cycle Budget (N=4)

| Phase          | Cycles | FSM state reported        |
|----------------|--------|---------------------------|
| LOAD_WEIGHTS   | 4      | `"LOAD_WEIGHTS"`          |
| STREAM         | 7      | `"STREAM"`                |
| DRAIN          | 2      | `"DRAIN"`                 |
| Done assertion | 1      | `"DONE"` (harness-derived)|
| **Total**      | **14** | matches `expected_cycles()`|

The DRAIN phase is 3 hardware cycles (drain_cyc 0–2), but `done` fires on the last
one (drain_cyc == N−2 == 2), so the harness reports it as `"DONE"` rather than
`"DRAIN"`, leaving 2 visible DRAIN cycles and 1 DONE cycle in the emitted trace.
