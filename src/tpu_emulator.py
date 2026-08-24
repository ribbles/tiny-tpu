import numpy as np

def run_tpu_matmul(image_bytes, weights_bytes, shape_img, shape_w):
    """
    Emulates the 4x4 weight-stationary tiny-tpu array behavior.
    Processes any batch size instantly using vectorized 4x4 block math.
    """
    # 1. Unpack the raw byte arrays back into standard data types
    # Works cleanly for 1 image or a batch of 60,000 images
    A = np.frombuffer(image_bytes, dtype=np.int8).reshape(shape_img).astype(np.int32)
    B = np.frombuffer(weights_bytes, dtype=np.int8).reshape(shape_w).astype(np.int32)
    
    rows_A, cols_A = A.shape
    rows_B, cols_B = B.shape
    assert cols_A == rows_B, "Inner matrix dimensions must match!"
    
    # 2. Enforce the physical 4x4 hardware padding boundaries of TinyTPU
    pad_cols_A = (4 - (cols_A % 4)) % 4
    pad_classes = (4 - (cols_B % 4)) % 4
    
    A_padded = np.pad(A, ((0, 0), (0, pad_cols_A)), mode='constant', constant_values=0)
    B_padded = np.pad(B, ((0, pad_cols_A), (0, pad_classes)), mode='constant', constant_values=0)
    
    # 3. Compute the entire payload at once via C-optimized integer math
    accumulators = np.dot(A_padded, B_padded)
    
    # 4. Strip the 4x4 hardware padding columns back off to get our real 10 outputs
    C_final = accumulators[:, :cols_B]
    
    # 5. Pack results back to raw 32-bit hardware bytes (4 bytes per int32 element)
    return C_final.tobytes()
