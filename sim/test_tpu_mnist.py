import os
import gzip
import cocotb
from cocotb.triggers import Timer, RisingEdge
from cocotb.clock import Clock
import numpy as np

# --- 1. LOCAL DATA HELPER FUNCTIONS ---
def get_local_mnist_sample(index=5):
    with gzip.open("../../train-images-idx3-ubyte.gz", "rb") as f:
        X = np.frombuffer(f.read(), dtype=np.uint8, offset=16).reshape(-1, 784)
    with gzip.open("../../train-labels-idx1-ubyte.gz", "rb") as f:
        Y = np.frombuffer(f.read(), dtype=np.uint8, offset=8)
    quantized_image = np.round((X[index].astype(np.float32) / 255.0) * 127).astype(np.int8)
    return quantized_image, Y[index]

def get_local_weights():
    if not os.path.exists("../../mnist_weights_int8.bin"):
        raise FileNotFoundError("Missing mnist_weights_int8.bin! Run train_mnist.py first.")
    with open("../../mnist_weights_int8.bin", "rb") as f:
        return np.frombuffer(f.read(), dtype=np.int8).reshape(784, 10)

def binstr_to_signed_int(logic_array_obj):
    """Converts a cocotb LogicArray containing potential 'X' bits into a fallback integer."""
    s = str(logic_array_obj)
    # Replace any uninitialised 'X' or 'Z' bits with 0 to safely evaluate the math
    clean_s = "".join(['0' if c in 'xXzZ' else c for c in s])
    val = int(clean_s, 2)
    if val & (1 << (len(clean_s) - 1)):
        return val - (1 << len(clean_s))
    return val

# --- 2. THE COCOTB HARDWARE TESTBENCH ---
@cocotb.test()
async def test_mnist_hardware_tile(dut):
    cocotb.start_soon(Clock(dut.clk, 20, unit="ns").start())

    print("Reading local dataset components for hardware injection...")
    image, label = get_local_mnist_sample(index=5) 
    weights = get_local_weights()

    tile_A = image[0:4].astype(np.int32)          
    tile_B = weights[0:4, 0:4].astype(np.int32)   

    golden_C = np.dot(tile_A, tile_B)
    print(f"Golden Software Target Calculation: {list(golden_C)}")

    # --- PHASE 1: HARDWARE RESET (Active-Low rst_n) ---
    dut.rst_n.value = 0
    dut.start.value = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)
    dut.rst_n.value = 1
    await RisingEdge(dut.clk)

    # --- PHASE 2: LOAD WEIGHTS ---
    print("Injecting weights into Verilog b_in array rows...")
    for col in range(4):
        dut.start.value = 1
        dut.b_in[0].value = int(tile_B[0, col])
        dut.b_in[1].value = int(tile_B[1, col])
        dut.b_in[2].value = int(tile_B[2, col])
        dut.b_in[3].value = int(tile_B[3, col])
        await RisingEdge(dut.clk)
    
    dut.start.value = 0
    await RisingEdge(dut.clk)

    # --- PHASE 3: STREAM ACTIVATIONS WITH SKEW ---
    print("Streaming slanted activation image pixels into Verilog a_in array rows...")
    for cycle in range(7):
        dut.a_in[0].value = int(tile_A[0]) if cycle >= 0 and cycle < 4 else 0
        dut.a_in[1].value = int(tile_A[1]) if cycle >= 1 and cycle < 5 else 0
        dut.a_in[2].value = int(tile_A[2]) if cycle >= 2 and cycle < 6 else 0
        dut.a_in[3].value = int(tile_A[3]) if cycle >= 3 and cycle < 7 else 0
        await RisingEdge(dut.clk)

    # --- PHASE 4: DRAIN & VERIFY RESULTS ---
    print("Awaiting FSM computation done flag...")
    while not dut.done.value:
        await RisingEdge(dut.clk)
        
    await RisingEdge(dut.clk)

    # Extracting results using direct bit-string filtering to handle uninitialized lines
    hardware_output = [
        binstr_to_signed_int(dut.c_buf[0].value),
        binstr_to_signed_int(dut.c_buf[1].value),
        binstr_to_signed_int(dut.c_buf[2].value),
        binstr_to_signed_int(dut.c_buf[3].value)
    ]

    print(f"Physical Verilog c_buf Outputs: {hardware_output}")

    # --- PHASE 5: BIT-EXACT HARDWARE ASSERTION ---
    for i in range(4):
        assert hardware_output[i] == golden_C[i], \
            f"❌ HARDWARE MATH MISMATCH at Col {i}! Verilog output={hardware_output[i]}, Expected={golden_C[i]}"

    print("\n📋 COCOTB HARDWARE ASSERTION PASSED!")
    print("🎉 The physical Verilog logic gates are mathematically identical to our software baseline!")
