import numpy as np


def build_unified_command(activation_scalar: int, weight_row: np.ndarray) -> bytes:
    """Build one 0x03 command that computes a single scalar-by-row contribution."""
    weight_row = np.asarray(weight_row, dtype=np.int32).reshape(4)

    payload = bytearray([0x03])

    # The current shell decodes only the first 4 bytes of the weight block.
    for value in weight_row:
        payload.append(int(value) & 0xFF)
    payload.extend([0] * 12)

    # The shell uses only the first activation byte from the first row.
    payload.append(int(activation_scalar) & 0xFF)
    payload.extend([0] * 15)

    return bytes(payload)


def decode_result_frame(raw_back_bytes: bytes) -> np.ndarray:
    if len(raw_back_bytes) != 16:
        raise TimeoutError(f"Expected 16 result bytes, received {len(raw_back_bytes)}")
    return np.frombuffer(raw_back_bytes, dtype=np.int32, count=4).copy()


def run_unified_row_contribution(ser, activation_scalar: int, weight_row: np.ndarray) -> np.ndarray:
    """Send one scalar-times-row contribution and return the 4-lane int32 result."""
    ser.write(build_unified_command(activation_scalar, weight_row))
    ser.flush()
    return decode_result_frame(ser.read(16))


def run_unified_row_matmul(ser, activation_tile: np.ndarray, weight_tile: np.ndarray) -> np.ndarray:
    """Compute one 1x4 by 4x4 tile via four 0x03 shell transactions."""
    activation_tile = np.asarray(activation_tile, dtype=np.int32).reshape(4)
    weight_tile = np.asarray(weight_tile, dtype=np.int32).reshape(4, 4)

    accum = np.zeros(4, dtype=np.int32)
    for lane in range(4):
        accum += run_unified_row_contribution(ser, int(activation_tile[lane]), weight_tile[lane, :])
    return accum


def run_unified_matmul(ser, matrix_a: np.ndarray, matrix_b: np.ndarray) -> np.ndarray:
    """Host-side tiled matmul over the current 0x03 shell protocol."""
    matrix_a = np.asarray(matrix_a, dtype=np.int8)
    matrix_b = np.asarray(matrix_b, dtype=np.int8)

    if matrix_a.ndim != 2 or matrix_b.ndim != 2:
        raise ValueError("matrix_a and matrix_b must both be 2D")
    if matrix_a.shape[1] != matrix_b.shape[0]:
        raise ValueError(
            f"Shape mismatch: A is {matrix_a.shape}, B is {matrix_b.shape} - inner dims must match"
        )

    rows_a, cols_a = matrix_a.shape
    cols_b = matrix_b.shape[1]
    pad_inner = (4 - (cols_a % 4)) % 4
    pad_cols = (4 - (cols_b % 4)) % 4

    a_padded = np.pad(matrix_a.astype(np.int32), ((0, 0), (0, pad_inner)), constant_values=0)
    b_padded = np.pad(matrix_b.astype(np.int32), ((0, pad_inner), (0, pad_cols)), constant_values=0)

    result = np.zeros((rows_a, b_padded.shape[1]), dtype=np.int32)

    for row_idx in range(rows_a):
        for col_block in range(0, b_padded.shape[1], 4):
            accum = np.zeros(4, dtype=np.int32)
            for inner_step in range(0, a_padded.shape[1], 4):
                activation_tile = a_padded[row_idx, inner_step:inner_step + 4]
                weight_tile = b_padded[inner_step:inner_step + 4, col_block:col_block + 4]
                accum += run_unified_row_matmul(ser, activation_tile, weight_tile)
            result[row_idx, col_block:col_block + 4] = accum

    return result[:, :cols_b]