import os
import gzip
import cocotb
from cocotb.triggers import Timer, RisingEdge
from cocotb.clock import Clock
import numpy as np

# --- 1. LOCAL DATA PARSING UTILITIES ---
def get_local_mnist_sample(index=5):
    with gzip.open("../../train-images-idx3-ubyte.gz", "rb") as f:
        X = np.frombuffer(f.read(), dtype=np.uint8, offset=16).reshape(-1, 784)
    with gzip.open("../../train-labels-idx1-ubyte.gz", "rb") as f:
        Y = np.frombuffer(f.read(), dtype=np.uint8, offset=8)
    quantized_image = np.round((X[index].astype(np.float32) / 255.0) * 127).astype(np.int8)
    return quantized_image, Y[index]

def get_local_weights():
    with open("../../mnist_weights_int8.bin", "rb") as f:
        return np.frombuffer(f.read(), dtype=np.int8).reshape(784, 10)

# --- 2. INTEGRATION TEST CORE LOOP ---
@cocotb.test()
async def test_decoder_to_core_pipeline(dut):
    cocotb.start_soon(Clock(dut.clk, 37, unit="ns").start())

    print("Loading reference matrix dataset shapes...")
    image, _ = get_local_mnist_sample(index=5)
    weights = get_local_weights()

    # Create true 4x4 matrices matching your 2D architecture footprints
    tile_A = image[0:4].astype(np.int32)
    # Replicate rows to build a true 4x4 reference evaluation block
    matrix_A = np.tile(tile_A, (4, 1))
    matrix_B = weights[0:4, 0:4].astype(np.int32)
    
    # Golden target calculation for Matrix multiplication AXB
    golden_C = np.dot(matrix_A, matrix_B)
    print(f"Software Target Verification Array Row 0: {list(golden_C[0])}")

    # --- PHASE 1: HARDWARE RESET ---
    dut.rst_n.value = 0
    dut.rx_valid.value = 0
    dut.rx_byte.value = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)
    dut.rst_n.value = 1
    await RisingEdge(dut.clk)

    # --- PHASE 2: SEND WEIGHT MATRIX (Opcode 0x01) ---
    print("\n[Sim] Injecting 0x01 Weight Matrix Command (16 Bytes)...")
    dut.rx_byte.value = 0x01
    dut.rx_valid.value = 1
    await RisingEdge(dut.clk)
    
    # Send all 16 elements row-by-row
    for r in range(4):
        for c in range(4):
            dut.rx_byte.value = int(matrix_B[r, c]) & 0xFF
            dut.rx_valid.value = 1
            await RisingEdge(dut.clk)
            
    dut.rx_valid.value = 0
    await RisingEdge(dut.clk)

    # --- PHASE 3: SEND ACTIVATION MATRIX (Opcode 0x02) ---
    print("[Sim] Injecting 0x02 Activation Matrix Command (16 Bytes)...")
    dut.rx_byte.value = 0x02
    dut.rx_valid.value = 1
    await RisingEdge(dut.clk)
    
    # Send all 16 elements row-by-row
    for r in range(4):
        for c in range(4):
            dut.rx_byte.value = int(matrix_A[r, c]) & 0xFF
            dut.rx_valid.value = 1
            await RisingEdge(dut.clk)

    dut.rx_valid.value = 0
    print("Awaiting core processing execution completion...")
    
    # Monitor the done flag line
    timeout = 500
    while not dut.u_cmd_decoder.tpu_done.value and timeout > 0:
        await RisingEdge(dut.clk)
        timeout -= 1

    assert timeout > 0, "❌ TIMEOUT ERROR: TPU Core engine never raised its execution done flag!"
    await RisingEdge(dut.clk)

    # --- PHASE 4: ASSERT RESULTS ---
    raw_bits = str(dut.output_score_register.value)
    clean_bits = "".join(['0' if c in 'xXzZ' else c for c in raw_bits])
    
    hardware_output = []
    for i in range(4):
        segment = clean_bits[i*32 : (i+1)*32]
        val = int(segment, 2)
        if val & (1 << 31):
            val -= (1 << 32)
        hardware_output.append(val)

    hardware_output.reverse()
    print(f"\nPhysical Silicon Decoded Array Row 0: {hardware_output}")

    # Verify that the physical hardware match matches our reference calculation
    for i in range(4):
        assert hardware_output[i] == golden_C[0, i], \
            f"❌ MATH MISMATCH! Col {i} returned {hardware_output[i]}, Expected={golden_C[0, i]}"

    print("\n📋 DECODER-TO-CORE INTEGRATION CHECK PASSED!")
