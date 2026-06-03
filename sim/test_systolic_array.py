"""
cocotb wiring test for systolic_array.sv (no controller).

Tests
-----
weight_mapping_check  — load an asymmetric (non-symmetric) weight matrix;
                        verify every dbg_weight[i][j] holds B[i][j], not B[j][i].
                        A row/col transposition bug in the generate loop is caught here.

wiring_basic          — identity weights; drive act_west = [1,1,1,1] for one cycle,
                        then zeros; verify psum_south = [1,1,1,1] after exactly 3 more
                        cycles.  Tests that all four diagonal PE paths and their drain
                        chains are wired correctly end-to-end.

single_row_path       — identity weights; drive only act_west[0]=5, rest=0;
                        verify psum_south[0]=5 at T=3 and psum_south[1..3]=0.
                        Isolates the row-0 → column-0 path and confirms cross-column
                        leakage does not occur.

Timing contract (N=4, identity weights)
----------------------------------------
With act_west[i]=v at T=0 only:
  PE[i][i] fires (weight=1) when its act_in arrives: cycle T=i  (i register hops)
  Result drains N-1-i rows to psum_south: (N-1-i) more cycles
  ──────────────────────────────────────────────
  Total drain time = i + (N-1-i) = N-1 = 3 cycles for every i

  ⇒ All psum_south[i] = v simultaneously at T=3.

Why FallingEdge for reads?
In Verilator+cocotb 2.x the VPI cbValueChange callback for RisingEdge fires
*before* Verilator's eval() commits always_ff nonblocking results.  Awaiting a
FallingEdge forces a second eval() that flushes post-edge register values into
the VPI read buffer.  See test_pe.py for the detailed explanation.
"""

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

N = 4  # array dimension (matches RTL parameter)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def to_uv(x: int, bits: int) -> int:
    """Signed Python int → unsigned two's-complement value for cocotb write."""
    return x & ((1 << bits) - 1)


def sv_signed(handle) -> int:
    """Read a cocotb logic handle as a signed integer (cocotb 2.x API)."""
    return handle.value.to_signed()


async def reset_dut(dut) -> None:
    """Assert rst_n=0 for 2 cycles, release, advance 1 cycle.  No output reads."""
    dut.rst_n.value = 0
    dut.load_weight.value = 0
    for i in range(N):
        dut.weight_col[i].value = 0
        dut.act_west[i].value = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)
    dut.rst_n.value = 1
    await RisingEdge(dut.clk)


async def load_weights(dut, B: list[list[int]]) -> None:
    """
    Stream weight matrix B into the array column-by-column over N cycles.

    Protocol (matches load_col_oh one-hot selector in systolic_array.sv):
      Assert load_weight=1 for N consecutive cycles.
      On cycle k (0-based), drive weight_col[i] = B[i][k].
      The one-hot shift register gates each weight_col to column k only.

    After reset, load_col_oh is bit-0-hot, so column 0 loads first.
    Returns in the active phase after the last FallingEdge; dbg_weight is
    immediately readable.
    """
    dut.load_weight.value = 1
    for k in range(N):
        for i in range(N):
            dut.weight_col[i].value = to_uv(B[i][k], 8)
        await RisingEdge(dut.clk)   # PE[*][k] captures B[*][k] at this edge
        await FallingEdge(dut.clk)  # flush VPI buffer; weight registers visible
    dut.load_weight.value = 0


async def clock_cycle(dut, act_west_vals: list[int]) -> None:
    """
    Drive act_west for one clock cycle, advance, then wait for FallingEdge.

    Returns in the active phase; outputs (psum_south, dbg_*) are readable.
    """
    for i in range(N):
        dut.act_west[i].value = to_uv(act_west_vals[i], 8)
    await RisingEdge(dut.clk)
    await FallingEdge(dut.clk)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@cocotb.test()
async def weight_mapping_check(dut):
    """
    Load an asymmetric weight pattern and verify dbg_weight[i][j] = B[i][j].

    Pattern: B[i][j] = i*N + j + 1 (row-major, 1..16).
    If the generate loop has i and j swapped, dbg_weight[i][j] would be
    j*N + i + 1 instead — this test detects that transposition.
    """
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await reset_dut(dut)

    B = [[i * N + j + 1 for j in range(N)] for i in range(N)]
    await load_weights(dut, B)

    for i in range(N):
        for j in range(N):
            expected = B[i][j]
            got = sv_signed(dut.dbg_weight[i][j])
            assert got == expected, (
                f"dbg_weight[{i}][{j}]: expected {expected}, got {got} "
                f"(transposition would give {B[j][i]})"
            )


@cocotb.test()
async def wiring_basic(dut):
    """
    Identity weights + all-ones activation pulse → psum_south = [1,1,1,1] at T=3.

    Drives act_west = [1,1,1,1] for exactly one cycle (T=0), then zeros.
    Because the diagonal timing is symmetric (row i fires at T=i, drains N-1-i
    more hops), every psum_south[i] = 1 simultaneously at T=N-1 = 3.

    Checks all four drain paths and verifies no pre-mature output (psum_south
    should be all-zero while the drain is still in flight).
    """
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await reset_dut(dut)

    identity = [[1 if i == j else 0 for j in range(N)] for i in range(N)]
    await load_weights(dut, identity)

    # T=0: single activation pulse on all rows simultaneously
    await clock_cycle(dut, [1, 1, 1, 1])
    for j in range(N):
        assert sv_signed(dut.psum_south[j]) == 0, (
            f"psum_south[{j}] at T=0: expected 0, got {sv_signed(dut.psum_south[j])}"
        )

    # T=1, T=2: drain in flight — all columns still zero
    await clock_cycle(dut, [0, 0, 0, 0])
    for j in range(N):
        assert sv_signed(dut.psum_south[j]) == 0, (
            f"psum_south[{j}] at T=1: expected 0, got {sv_signed(dut.psum_south[j])}"
        )

    await clock_cycle(dut, [0, 0, 0, 0])
    for j in range(N):
        assert sv_signed(dut.psum_south[j]) == 0, (
            f"psum_south[{j}] at T=2: expected 0, got {sv_signed(dut.psum_south[j])}"
        )

    # T=3: all four results arrive simultaneously
    await clock_cycle(dut, [0, 0, 0, 0])
    for j in range(N):
        assert sv_signed(dut.psum_south[j]) == 1, (
            f"psum_south[{j}] at T=3: expected 1, got {sv_signed(dut.psum_south[j])}"
        )


@cocotb.test()
async def single_row_path(dut):
    """
    Identity weights + single row-0 activation → only psum_south[0] fires.

    Drives act_west = [5, 0, 0, 0] for one cycle.  Because B=I4, only PE[0][0]
    has weight=1 (row 0, col 0).  PE[1..3][1..3] also have weight=1 but their
    act_in comes from act_west[1..3]=0 (always), so they never accumulate.

    Path: act_west[0]=5 → PE[0][0] (weight=1) → psum_v[1..4][0] → psum_south[0]=5
    Drain time: N-1 = 3 cycles.

    psum_south[1..3] must remain 0 throughout — any cross-column leakage is caught.
    """
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await reset_dut(dut)

    identity = [[1 if i == j else 0 for j in range(N)] for i in range(N)]
    await load_weights(dut, identity)

    v = 5

    # T=0: row-0 pulse only
    await clock_cycle(dut, [v, 0, 0, 0])

    # T=1, T=2: zeros (drain in progress)
    await clock_cycle(dut, [0, 0, 0, 0])
    await clock_cycle(dut, [0, 0, 0, 0])

    # T=3: result arrives at psum_south[0]; columns 1..3 must be 0
    await clock_cycle(dut, [0, 0, 0, 0])
    assert sv_signed(dut.psum_south[0]) == v, (
        f"psum_south[0] at T=3: expected {v}, got {sv_signed(dut.psum_south[0])}"
    )
    for j in range(1, N):
        assert sv_signed(dut.psum_south[j]) == 0, (
            f"psum_south[{j}] at T=3: expected 0, got {sv_signed(dut.psum_south[j])}"
        )
