"""
cocotb integration test for tiny_tpu_top.sv.

Tests
-----
matmul_random_20   - 20 random 4×4 matmuls (int8 inputs); each result must
                     bit-match matmul_golden(A, B) from golden.py.

cycle_count_matches - one fixed matmul; verifies done asserts exactly at
                      expected_cycles() = 14 clock cycles after start.

Result capture timing
---------------------
The systolic array computes (a_buf^T @ B) where a_buf stores A transposed.
tiny_tpu_top handles the transpose internally, so the test just loads A and B
normally and expects c_buf to equal A @ B.

psum_south[j] carries C[r][j] at relative stream/drain cycle r+j+(N-1).
tiny_tpu_top's always_ff latches each element at the right cycle.

Cocotb timing note (same as test_pe.py and test_systolic_array.py)
-------------------------------------------------------------------
Await FallingEdge after every RisingEdge that reads registered outputs, to
flush Verilator's post-edge NBA results into the VPI read buffer.
"""

import numpy as np
import cocotb
from cocotb.clock import Clock
from cocotb.triggers import FallingEdge, RisingEdge

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from golden import matmul_golden, expected_cycles

N = 4
SEED = 42


def to_uv(x: int, bits: int) -> int:
    return x & ((1 << bits) - 1)


def sv_signed(handle) -> int:
    return handle.value.to_signed()


async def reset_dut(dut) -> None:
    dut.rst_n.value = 0
    dut.start.value = 0
    for i in range(N):
        for j in range(N):
            dut.a_in[i][j].value = 0
            dut.b_in[i][j].value = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)
    dut.rst_n.value = 1
    await RisingEdge(dut.clk)
    await FallingEdge(dut.clk)


async def load_and_run(dut, A: np.ndarray, B: np.ndarray) -> int:
    """
    Drive A and B into the DUT, assert start, wait for done.

    Returns the number of clock cycles from start rising edge to done rising edge.
    """
    # Write matrix inputs
    for i in range(N):
        for j in range(N):
            dut.a_in[i][j].value = to_uv(int(A[i, j]), 8)
            dut.b_in[i][j].value = to_uv(int(B[i, j]), 8)

    # Pulse start for one cycle (not counted toward expected_cycles)
    dut.start.value = 1
    await RisingEdge(dut.clk)
    await FallingEdge(dut.clk)
    dut.start.value = 0

    cycle_count = 0

    # Wait for done (registered, fires 14 cycles after start for N=4).
    while True:
        await RisingEdge(dut.clk)
        await FallingEdge(dut.clk)
        cycle_count += 1
        if dut.done.value == 1:
            # One extra cycle: C[N-1][N-1] is captured by tiny_tpu_top one cycle
            # after done fires (psum_south[N-1] pre-edge at this posedge = C[N-1][N-1]).
            await RisingEdge(dut.clk)
            await FallingEdge(dut.clk)
            break
        if cycle_count > 100:
            raise TimeoutError("done never asserted after 100 cycles")

    return cycle_count


def read_c_buf(dut) -> np.ndarray:
    """Read the 4×4 result buffer as int64 numpy array."""
    C = np.zeros((N, N), dtype=np.int64)
    for i in range(N):
        for j in range(N):
            C[i, j] = dut.c_buf[i][j].value.to_signed()
    return C


def pad4x4(M: np.ndarray) -> np.ndarray:
    """Zero-pad a matrix to 4×4."""
    out = np.zeros((N, N), dtype=np.int8)
    r, c = M.shape
    out[:r, :c] = M
    return out


@cocotb.test()
async def matmul_random_20(dut):
    """
    20 random 4×4 int8 matmuls must bit-match matmul_golden(A, B).

    Matrices are randomly generated in [-128, 127] using a fixed seed.
    After each matmul the DUT is NOT reset between iterations; done
    returns to IDLE automatically, so we pulse start again immediately.
    """
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await reset_dut(dut)

    rng = np.random.default_rng(SEED)
    failures = []

    for trial in range(20):
        A = rng.integers(-128, 128, size=(N, N), dtype=np.int8)
        B = rng.integers(-128, 128, size=(N, N), dtype=np.int8)

        await load_and_run(dut, A, B)

        got = read_c_buf(dut)
        expected = matmul_golden(A, B)

        if not np.array_equal(got, expected):
            failures.append(
                f"Trial {trial}: mismatch\n"
                f"  A=\n{A}\n  B=\n{B}\n"
                f"  expected=\n{expected}\n  got=\n{got}"
            )

        # One idle cycle between runs
        await RisingEdge(dut.clk)
        await FallingEdge(dut.clk)

    assert not failures, "\n".join(failures)


@cocotb.test()
async def cycle_count_matches(dut):
    """
    done must assert exactly expected_cycles()=14 clock cycles after start.

    Uses a simple fixed matrix (identity × identity = identity) so the timing
    is independent of data content.
    """
    cocotb.start_soon(Clock(dut.clk, 10, unit="ns").start())
    await reset_dut(dut)

    A = np.eye(N, dtype=np.int8)
    B = np.eye(N, dtype=np.int8)

    cycles = await load_and_run(dut, A, B)

    assert cycles == expected_cycles(), (
        f"done cycle count: expected {expected_cycles()}, got {cycles}"
    )

    # Also verify result correctness for this case
    got = read_c_buf(dut)
    expected = matmul_golden(A, B)
    np.testing.assert_array_equal(got, expected, err_msg="I@I should equal I")
