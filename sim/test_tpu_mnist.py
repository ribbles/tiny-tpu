import os
import gzip
import cocotb
from cocotb.triggers import Timer, RisingEdge
from cocotb.clock import Clock
import numpy as np

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

@cocotb.test()
async def test_mnist_hardware_tile(dut):
    cocotb.start_soon(Clock(dut.clk, 37, unit="ns").start())

    print("Reading dataset components...")
    image, label = get_local_mnist_sample(index=5) 
    weights = get_local_weights()

    tile_A = image[380:384].astype(np.int32)          
    matrix_A = np.zeros((4, 4), dtype=np.int32)
    matrix_A[0, :] = tile_A

    tile_B = weights[380:384, 0:4].astype(np.int32)   
    matrix_B = np.zeros((4, 4), dtype=np.int32)
    matrix_B[0, :] = tile_B[0, :] 

    golden_C = np.dot(matrix_A, matrix_B)
    print(f"Golden Software Target Calculation Row 0: {list(golden_C)}")

    # --- PHASE 1: HARDWARE RESET ---
    dut.rst_n.value = 0
    dut.rx_valid.value = 0
    dut.rx_byte.value = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)
    dut.rst_n.value = 1
    await RisingEdge(dut.clk)

    # --- PHASE 2: SEND UNIFIED 32-BYTE COMPUTE BLOCK (Opcode 0x03) ---
    print("\nInjecting 0x03 Unified Command Payload (32 Bytes)...")
    dut.rx_byte.value = 0x03
    dut.rx_valid.value = 1
    await RisingEdge(dut.clk)
    
    # 1. Stream the 16 weights bytes
    for r in range(4):
        for c in range(4):
            dut.rx_byte.value = int(matrix_B[r, c]) & 0xFF
            dut.rx_valid.value = 1
            await RisingEdge(dut.clk)
            
    # 2. Stream the 16 activation pixels bytes
    for r in range(4):
        for c in range(4):
            dut.rx_byte.value = int(matrix_A[r, c]) & 0xFF
            dut.rx_valid.value = 1
            await RisingEdge(dut.clk)

    dut.rx_valid.value = 0
    print("Awaiting core processing completion...")
    
    timeout = 1000
    while not dut.u_cmd_decoder.tpu_done.value and timeout > 0:
        await RisingEdge(dut.clk)
        timeout -= 1

    assert timeout > 0, "❌ TIMEOUT ERROR: TPU Core engine never raised execution done!"
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)

    # --- PHASE 3: READ AND PARSE SCORES ---
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

    for i in range(4):
        assert hardware_output[i] == golden_C[0, i], \
            f"❌ HARDWARE MATH MISMATCH at Col {i}! Verilog={hardware_output[i]}, Expected={golden_C[0, i]}"

    print("\n📋 COCOTB HARDWARE MNIST ASSERTION PASSED!")
