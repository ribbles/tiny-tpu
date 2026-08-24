"""
Golden reference model for TinyTPU matrix multiplication.

This is the oracle - RTL output must bit-match this for all inputs.
The 4×4 hardware constraint is a single-pass limit, not a model limit;
matmul_golden accepts any compatible shapes so L3 tiling can be verified here.
"""

import numpy as np


def matmul_golden(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """
    Integer matrix multiply C = A @ B using int64 accumulators.

    Validates only inner-dimension compatibility (A.shape[1] == B.shape[0]).
    Inputs are cast to int64 before multiplication to avoid int8 overflow.
    Returns int64 result array.
    """
    if A.shape[1] != B.shape[0]:
        raise ValueError(
            f"Shape mismatch: A is {A.shape}, B is {B.shape} - inner dims must match"
        )
    return (A.astype(np.int64) @ B.astype(np.int64))


def to_q(x: float, frac_bits: int = 0) -> np.int8:
    """
    Quantize a float to int8.

    With frac_bits=0 (default): rounds x to the nearest integer, then clamps
    to [-128, 127].  With frac_bits>0: scales x by 2**frac_bits first
    (fixed-point Q-format), then clamps.
    """
    scaled = x * (2 ** frac_bits)
    clamped = int(np.clip(round(scaled), -128, 127))
    return np.int8(clamped)


def expected_cycles() -> int:
    """
    Cycle count for the 4×4 physical array to fully drain any matmul.

    The drain is always governed by the PHYSICAL array dimensions, not the
    logical matrix size (smaller matrices are zero-padded to 4×4).

    N_PHYS = 4

    Phase breakdown:
      LOAD_WEIGHTS : N_PHYS cycles        = 4   (load one row of weights per cycle)
      STREAM+skew  : N_PHYS + (N_PHYS-1) = 7   (N_PHYS cols + row-skew pipeline fill)
      DRAIN        : N_PHYS - 1           = 3   (last psum propagates down N_PHYS-1 hops)

    Total: 4 + 7 + 3 = 14 cycles.

    This constant is used by cocotb tests to assert the hardware finishes exactly
    on time - it must NOT change with matrix content.
    """
    N_PHYS = 4
    load   = N_PHYS            # one weight-row loaded per clock
    stream = N_PHYS + (N_PHYS - 1)  # activation cols + skew pipeline fill
    drain  = N_PHYS - 1        # psum propagation through bottom row
    return load + stream + drain  # 14


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_golden_basic():
    """Hand-verified 2×2 and 4×4 examples."""

    # --- 2×2 hand-check ---
    # A = [[1, 2],    B = [[5, 6],
    #      [3, 4]]         [7, 8]]
    #
    # C[0][0] = 1*5 + 2*7 = 5  + 14 = 19
    # C[0][1] = 1*6 + 2*8 = 6  + 16 = 22
    # C[1][0] = 3*5 + 4*7 = 15 + 28 = 43
    # C[1][1] = 3*6 + 4*8 = 18 + 32 = 50

    A2 = np.array([[1, 2], [3, 4]], dtype=np.int8)
    B2 = np.array([[5, 6], [7, 8]], dtype=np.int8)
    expected_2x2 = np.array([[19, 22], [43, 50]], dtype=np.int64)
    result_2x2 = matmul_golden(A2, B2)
    np.testing.assert_array_equal(result_2x2, expected_2x2)

    # --- 4×4 hand-check ---
    # Identity × ascending: I @ M = M
    I4 = np.eye(4, dtype=np.int8)
    M4 = np.array(
        [[1, 2, 3, 4],
         [5, 6, 7, 8],
         [9, 10, 11, 12],
         [13, 14, 15, 16]],
        dtype=np.int8,
    )
    expected_4x4 = M4.astype(np.int64)
    result_4x4 = matmul_golden(I4, M4)
    np.testing.assert_array_equal(result_4x4, expected_4x4)

    # Also cross-check a non-trivial 4×4 against numpy directly
    rng = np.random.default_rng(42)
    A4 = rng.integers(-10, 10, size=(4, 4), dtype=np.int8)
    B4 = rng.integers(-10, 10, size=(4, 4), dtype=np.int8)
    np.testing.assert_array_equal(
        matmul_golden(A4, B4),
        A4.astype(np.int64) @ B4.astype(np.int64),
    )


def test_expected_cycles():
    """expected_cycles() returns 14 for the fixed 4×4 physical array."""
    assert expected_cycles() == 14


def test_shape_mismatch():
    """matmul_golden raises on incompatible shapes."""
    import pytest

    A = np.zeros((4, 3), dtype=np.int8)
    B = np.zeros((4, 4), dtype=np.int8)
    with pytest.raises(ValueError, match="inner dims must match"):
        matmul_golden(A, B)


def test_to_q():
    """to_q clamps to int8 range and applies frac_bits scaling."""
    assert to_q(1.0) == np.int8(1)
    assert to_q(127.0) == np.int8(127)
    assert to_q(128.0) == np.int8(127)   # clamp
    assert to_q(-128.0) == np.int8(-128)
    assert to_q(-200.0) == np.int8(-128)  # clamp
    assert to_q(0.5, frac_bits=1) == np.int8(1)  # 0.5 * 2 = 1.0 -> 1
