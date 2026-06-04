# RTL - Signal Dictionary & Dataflow Spec

## Module Hierarchy

```
tiny_tpu_top
└── systolic_array          (4×4 PE grid)
    └── pe  ×16             (MAC cell, one per row/column)
    controller              (IDLE→LOAD_WEIGHTS→STREAM→DRAIN→DONE FSM)
```

---

## Dataflow: weight-stationary systolic array

### What the hardware computes

`C = A · B` for signed 8-bit matrices, with 32-bit accumulators.

| Matrix | Role | Location |
|--------|------|----------|
| B | Stationary weights | PE[i][j] holds B[i][j] permanently for one pass |
| A | Streaming activations | Enter from the LEFT edge, one row per PE-row |
| C | Accumulated results | Exit from the BOTTOM edge, one column per PE-column |

### Weight-loading scheme (column-by-column, N cycles)

The controller asserts `load_weight=1` for **exactly N consecutive cycles** during the
`LOAD_WEIGHTS` state.  On each cycle k (k = 0 … N−1):

- `weight_col[i]` must carry **B[i][k]** (row i, column k of B).
- An internal one-hot shift register (`load_col_oh[N-1:0]`) gates the per-PE
  `load_weight` signal: only PEs in column k capture the weight that cycle.

```
Cycle 0: weight_col = {B[0][0], B[1][0], B[2][0], B[3][0]}  → PE[*][0] loaded
Cycle 1: weight_col = {B[0][1], B[1][1], B[2][1], B[3][1]}  → PE[*][1] loaded
Cycle 2: weight_col = {B[0][2], B[1][2], B[2][2], B[3][2]}  → PE[*][2] loaded
Cycle 3: weight_col = {B[0][3], B[1][3], B[2][3], B[3][3]}  → PE[*][3] loaded
```

After N cycles every PE[i][j] holds B[i][j] and `load_weight` is deasserted.
The one-hot selector resets to bit-0-hot on `rst_n`, so repeated load passes
always start from column 0.

### Activation skew (diagonal stagger)

A weight-stationary systolic array requires that element A[i][k] arrives at
column k on the **same cycle** that B[k][j] has been accumulating at PE[i][j].
Because row i of A must traverse i PE hops before reaching column i, the left
edge must receive row i **delayed by i cycles** relative to row 0:

```
Cycle 0 of STREAM: act_west = { A[0][k], 0,        0,        0       }
Cycle 1 of STREAM: act_west = { A[0][k+1], A[1][k], 0,        0       }
Cycle 2 of STREAM: act_west = { A[0][k+2], A[1][k+1], A[2][k], 0      }
Cycle 3 of STREAM: act_west = { A[0][k+3], A[1][k+2], A[2][k+1], A[3][k] }
...
```

**This diagonal skew is applied by `controller.sv`, not `systolic_array.sv`.**
The array module connects `act_west[i]` directly to the left edge of row i.

Total stream cycles needed to fully clock a 4×4 matrix through: `N + (N−1) = 7`.

### Result drain

Partial sums exit the bottom edge (psum_south[j]) with the same diagonal skew
as the input: column j's result is valid `j` cycles after column 0's.  The
controller holds for `N−1 = 3` drain cycles to collect all columns.

**Total cycle count per 4×4 pass:**

```
LOAD_WEIGHTS : N       = 4 cycles
STREAM       : N+(N-1) = 7 cycles
DRAIN        : N-1     = 3 cycles
─────────────────────────────────
TOTAL        :           14 cycles
```

---

## Module: `pe`  (`rtl/pe.sv`)

**Parameters:** `DATA_W=8`, `ACC_W=32`

| Port | Dir | Width | Description |
|------|-----|-------|-------------|
| `clk` | in | 1 | Clock (rising-edge triggered) |
| `rst_n` | in | 1 | Active-low async reset |
| `load_weight` | in | 1 | Capture `weight_in` into `weight_reg` this cycle |
| `weight_in` | in | `DATA_W` | Signed weight to load |
| `act_in` | in | `DATA_W` | Signed activation from the left |
| `psum_in` | in | `ACC_W` | Signed partial sum from above |
| `act_out` | out | `DATA_W` | `act_in` delayed 1 cycle (passes right) |
| `psum_out` | out | `ACC_W` | `psum_in + weight_reg × act_in` (registered) |
| `dbg_weight` | out | `DATA_W` | Combinational alias for `weight_reg` |

**Timing:** inputs captured on posedge clk; outputs reflect the captured values
one cycle later.  The product `weight_reg × act_in` uses the **pre-edge**
`weight_reg` (nonblocking assignment semantics), so a simultaneous `load_weight`
does NOT corrupt the current cycle's accumulation.

---

## Module: `systolic_array`  (`rtl/systolic_array.sv`)

**Parameters:** `N=4`, `DATA_W=8`, `ACC_W=32`

| Port | Dir | Width | Description |
|------|-----|-------|-------------|
| `clk` | in | 1 | Clock |
| `rst_n` | in | 1 | Active-low async reset |
| `load_weight` | in | 1 | Assert for N cycles to load all weights |
| `weight_col[N]` | in | `N×DATA_W` | One column of B per load cycle |
| `act_west[N]` | in | `N×DATA_W` | Left-edge activations (pre-skewed by controller) |
| `psum_south[N]` | out | `N×ACC_W` | Bottom-edge partial sums (results) |
| `dbg_weight[N][N]` | out | `N²×DATA_W` | `weight_reg` of every PE, row-major |
| `dbg_act[N][N]` | out | `N²×DATA_W` | `act_out` of every PE, row-major |
| `dbg_psum[N][N]` | out | `N²×ACC_W` | `psum_out` of every PE, row-major |

### Debug bundle indexing

All debug arrays are **[row i][column j]** (0-based, row-major).

```
dbg_weight[i][j]  →  stationary weight stored in PE[i][j]  =  B[i][j]
dbg_act   [i][j]  →  act_out of PE[i][j]  (activation passing to PE[i][j+1])
dbg_psum  [i][j]  →  psum_out of PE[i][j] (partial sum passing to PE[i+1][j])
```

`actIn` for PE[i][j] (as needed by the state schema) is derived as:

```
actIn[i][j] = (j == 0) ? act_west[i] : dbg_act[i][j-1]
```

---

## Internal wiring

```
act_h[i][0]   = act_west[i]          (left-edge input)
act_h[i][j+1] = PE[i][j].act_out     (activation passes right, registered)

psum_v[0][j]  = 0                    (top-edge boundary: zero psum)
psum_v[i+1][j]= PE[i][j].psum_out    (psum passes down, registered)

psum_south[j] = psum_v[N][j]         (bottom-edge output)
```

No combinational loops: all horizontal and vertical paths pass through at least
one registered PE output before re-entering another PE's input.

---

## Module: `controller`  (`rtl/controller.sv`)

**Parameters:** `N=4`, `DATA_W=8`

FSM states: `IDLE(0)` → `LOAD_WEIGHTS(1)` → `STREAM(2)` → `DRAIN(3)` → `IDLE`.

| Phase | Cycles | What happens |
|-------|--------|-------------|
| `LOAD_WEIGHTS` | N=4 | `load_weight=1`; `weight_col[i]=b_buf[i][load_cyc]` each cycle |
| `STREAM` | 2N-1=7 | Activations fed with diagonal skew; `act_west[i]=a_buf[i][stream_cyc-i]` |
| `DRAIN` | N-1=3 | `act_west=0`; psums propagate to bottom edge |
| Total | 14 | Matches `golden.py expected_cycles()` |

**Activation skew:** `a_buf` stores `A^T` (`a_buf[k][r]=A[r][k]`). Row `k` drives
`a_buf[k][stream_cyc-k]` for `stream_cyc ∈ [k, k+N-1]`, else 0.  With `a_buf=A^T`,
the array computes `(a_buf)^T @ B = A @ B`.

**`done`** is a registered output that fires for one cycle at the start of the cycle
after the last drain step (`drain_cyc == N-2`).

**Exposed counters:** `stream_cyc_out [2:0]`, `drain_cyc_out [1:0]` - used by
`tiny_tpu_top` for result capture.

---

## Module: `tiny_tpu_top`  (`rtl/tiny_tpu_top.sv`)

**Parameters:** `N=4`, `DATA_W=8`, `ACC_W=32`

| Port | Dir | Width | Description |
|------|-----|-------|-------------|
| `a_in[N][N]` | in | `N²×DATA_W` | Matrix A (natural order) |
| `b_in[N][N]` | in | `N²×DATA_W` | Matrix B |
| `c_buf[N][N]` | out | `N²×ACC_W` | Result C = A @ B, valid after `done` + 1 cycle |
| `done` | out | 1 | Registered pulse; fires 14 cycles after `start` |
| `dbg_fsm_state` | out | 3 | Controller FSM state |
| `dbg_weight[N][N]` | out | `N²×DATA_W` | PE weight registers |
| `dbg_act[N][N]` | out | `N²×DATA_W` | PE `act_out` signals |
| `dbg_psum[N][N]` | out | `N²×ACC_W` | PE `psum_out` signals |
| `dbg_west[N]` | out | `N×DATA_W` | Current `act_west` inputs |
| `dbg_south[N]` | out | `N×ACC_W` | Current `psum_south` outputs |

**A transpose:** `a_buf[k][r] = a_in[r][k]` is captured on `start`. This transpose
lets `controller` drive `a_buf[k][stream_cyc-k]`, which after the array's downward
accumulation yields `C = A @ B` (not `A^T @ B`).

**Result capture timing:** `c_buf[r][j]` is latched from `psum_south[j]` at the
posedge where the controller's counter equals `r+j+N` (stream phase) or
`r+j-(N-1)` (drain phase).  The one exception is `C[N-1][N-1]`, which is captured
one cycle after `done` fires (the last psum propagates to the bottom at exactly that
cycle).

**Caller protocol:**

1. Set `a_in`, `b_in`.
2. Pulse `start=1` for one cycle.
3. Wait for `done=1`.
4. Wait **one more cycle** (for `C[N-1][N-1]` to latch), then read `c_buf`.
