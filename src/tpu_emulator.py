import numpy as np

def run_tpu_matmul(matrix_a_bytes, matrix_b_bytes, shape_a, shape_b):
    """
    Emulates the physical Verilog TPU on the CPU.
    Accepts raw binary bytes, simulates INT8 math, and 
    returns a raw 32-bit binary stream mimicking the USB-C packet.
    """
    rows_a, cols_a = shape_a
    rows_b, cols_b = shape_b
    
    if cols_a != rows_a: # In our simple single layer, matrix_b shape is (784, 10)
        # Verify matrix inner dimensions match for valid multiplication
        assert cols_a == rows_b, f"Matrix dimension mismatch: {cols_a} vs {rows_b}"

    # 1. Unpack binary streams back into INT8 matrices, exactly like the FPGA RAM buffers
    arr_a = np.frombuffer(matrix_a_bytes, dtype=np.int8).reshape(shape_a)
    arr_b = np.frombuffer(matrix_b_bytes, dtype=np.int8).reshape(shape_b)
    
    # 2. Force true integer matrix multiplication
    # Normal NumPy multiplication uses standard registers, but casting to int32 
    # mimics the 32-bit hardware accumulators in your Verilog processing elements.
    accumulators = np.dot(arr_a.astype(np.int32), arr_b.astype(np.int32))
    
    # 3. Pack the final outputs back into raw 32-bit binary chunks (4 bytes per element)
    # This precisely simulates the byte stream that will come out of your UART TX wire.
    return accumulators.tobytes()
