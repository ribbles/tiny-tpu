"""
cocotb test suite for the Processing Element (pe.sv) MAC cell.

Tests
-----
pe_basic   — hand-verified vectors; confirms 1-cycle register latency and
             correct signed arithmetic (positive, negative, boundary values).
pe_random  — 200 random (weight, act, psum) triples; bit-matched against a
             Python reference model that applies 32-bit wrap-around semantics
             identical to the RTL accumulator. Fixed seed for reproducibility.

Timing contract (weight-stationary PE)
---------------------------------------
Cycle K   : drive load_weight=1, weight_in=W  →  weight_reg captures W at RisingEdge K
Cycle K+1 : drive act_in=A, psum_in=P          →  psum_out = P + W*A at RisingEdge K+1
                                                    act_out  = A

Why FallingEdge for reads?
In Verilator+cocotb the cbValueChange VPI callback for RisingEdge fires before
Verilator's eval() commits always_ff nonblocking assignments to the VPI read
buffer.  Awaiting a FallingEdge after every RisingEdge forces a new eval() that
flushes the post-edge register values into the VPI buffer, making them visible.
Writes remain legal in this phase (unlike ReadOnly), so inputs can be updated
immediately on return without an extra trigger.
"""

import ctypes
import random

import cocotb
from cocotb.clock import Clock
from cocotb.triggers import RisingEdge, FallingEdge

SEED = 42


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def to_uv(x: int, bits: int) -> int:
    """Signed Python int → unsigned 2's-complement value for cocotb signal write."""
    return x & ((1 << bits) - 1)


def sv_signed(handle) -> int:
    """Read a cocotb logic signal as a signed integer (cocotb 2.x API)."""
    return handle.value.to_signed()


def mac_model(weight: int, act: int, psum: int) -> tuple[int, int]:
    """
    Python reference model for one registered MAC cycle.

    Returns (psum_out, act_out).
    ctypes.c_int32 applies the same 32-bit two's-complement wrap-around
    that the RTL's ACC_W=32 accumulator produces.
    """
    raw = psum + weight * act
    return ctypes.c_int32(raw).value, act


async def reset_dut(dut) -> None:
    """Assert rst_n low for 2 cycles then release for 1 more.

    Returns immediately after the final RisingEdge (active phase).
    No FallingEdge needed here because no outputs are read.
    """
    dut.rst_n.value       = 0
    dut.load_weight.value = 0
    dut.weight_in.value   = 0
    dut.act_in.value      = 0
    dut.psum_in.value     = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)
    dut.rst_n.value = 1
    await RisingEdge(dut.clk)


async def load_weight(dut, weight: int) -> None:
    """
    Capture a stationary weight into weight_reg (1 clock cycle).

    Drives load_weight=1 / weight_in, advances one clock, then waits for
    the FallingEdge so the VPI buffer holds the committed register values.
    Deasserts load_weight=0 on return; caller is in the active phase and
    may immediately write new inputs or read dbg_weight.
    """
    dut.load_weight.value = 1
    dut.weight_in.value   = to_uv(weight, 8)
    await RisingEdge(dut.clk)   # weight_reg ← weight at this edge
    await FallingEdge(dut.clk)  # eval() refreshes VPI buffer; outputs visible
    dut.load_weight.value = 0


async def mac_step(dut, act: int, psum: int) -> tuple[int, int]:
    """
    Drive act_in/psum_in, advance one clock, return (psum_out, act_out).

    Caller must be in the active phase when calling this (i.e., after
    load_weight or reset_dut, both of which return in the active phase).
    Returns in the active phase after the FallingEdge read point.
    """
    dut.act_in.value  = to_uv(act, 8)
    dut.psum_in.value = to_uv(psum, 32)
    await RisingEdge(dut.clk)
    await FallingEdge(dut.clk)  # eval() refreshes VPI buffer
    return sv_signed(dut.psum_out), sv_signed(dut.act_out)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@cocotb.test()
async def pe_basic(dut):
    """
    Hand-verified weight=3 MAC sequence.

    Each vector: (act_in, psum_in, expected_psum_out, expected_act_out).
    Expected values computed by hand and double-checked against mac_model().
    """
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await reset_dut(dut)

    W = 3
    await load_weight(dut, W)

    # dbg_weight is combinational (assign dbg_weight = weight_reg), readable
    # in the active phase after load_weight's FallingEdge.
    assert sv_signed(dut.dbg_weight) == W, (
        f"dbg_weight should be {W} after load, got {sv_signed(dut.dbg_weight)}"
    )

    vectors = [
        # act   psum_in  exp_psum           exp_act  comment
        (   5,       0,      15,               5),   #  0 + 3×5   = 15
        (   7,      15,      36,               7),   # 15 + 3×7   = 36
        (  -2,      36,      30,              -2),   # 36 + 3×-2  = 30
        (   0,      30,      30,               0),   # 30 + 3×0   = 30
        (  -5,     -10,     -25,              -5),   # -10 + 3×-5 = -25
        ( 127,     -25,     356,             127),   # -25 + 3×127 = 356
        (-128,     356,     -28,            -128),   # 356 + 3×-128 = -28
    ]

    for act, psum_in, exp_psum, exp_act in vectors:
        got_psum, got_act = await mac_step(dut, act, psum_in)

        assert got_psum == exp_psum, (
            f"psum_out: W={W}, act={act}, psum_in={psum_in} "
            f"→ expected {exp_psum}, got {got_psum}"
        )
        assert got_act == exp_act, (
            f"act_out: act_in={act} → expected {exp_act}, got {got_act}"
        )
        # Stationary weight must not change during streaming.
        assert sv_signed(dut.dbg_weight) == W, (
            f"dbg_weight drifted from {W} to {sv_signed(dut.dbg_weight)}"
        )


@cocotb.test()
async def pe_random(dut):
    """
    200 random (weight, act, psum) triples; RTL output must bit-match mac_model().

    A fresh weight is loaded before each MAC to exercise load_weight in every
    iteration. Fixed seed={SEED} ensures the run is deterministic.
    """
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await reset_dut(dut)

    rng = random.Random(SEED)

    def rand_int8() -> int:
        return rng.randint(-128, 127)

    def rand_int32() -> int:
        return rng.randint(-(2**31), 2**31 - 1)

    for i in range(200):
        W = rand_int8()
        await load_weight(dut, W)   # returns in active phase

        A = rand_int8()
        P = rand_int32()
        exp_psum, exp_act = mac_model(W, A, P)

        got_psum, got_act = await mac_step(dut, A, P)

        assert got_psum == exp_psum, (
            f"[{i}] psum_out: W={W}, A={A}, P={P} "
            f"→ expected {exp_psum}, got {got_psum}"
        )
        assert got_act == exp_act, (
            f"[{i}] act_out: A={A} → expected {exp_act}, got {got_act}"
        )
