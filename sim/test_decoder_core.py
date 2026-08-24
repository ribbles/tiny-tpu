import os
import gzip
import cocotb
from cocotb.triggers import Timer, RisingEdge
from cocotb.clock import Clock
from cocotb.types import LogicArray
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

# --- 2. INTEGRATION TEST Core LOOP ---
@cocotb.test()
async def test_decoder_to_core_pipeline(dut):
    """
    Feeds a series of protocol bytes into the Command Decoder and 
    asserts the TPU core processes the math with bit-exact precision.
    """
    # Start a 27MHz clock matching the Tang Nano 9K crystal oscillator
    cocotb.start_soon(Clock(dut.clk, 37, unit="ns").start())

    print("Loading reference matrix dataset shapes...")
    image, _ = get_local_mnist_sample(index=5)
    weights = get_local_weights()

    # Isolate a single 4x4 matrix tile
    tile_A = image[0:4].astype(np.int32)
    tile_B = weights[0:4, 0:4].astype(np.int32)
    golden_C = np.dot(tile_A, tile_B)
    print(f"Software Target Verification Array: {list(golden_C)}")

    # --- PHASE 1: HARDWARE RESET ---
    dut.rst_n.value = 0
    dut.rx_valid.value = 0
    dut.rx_byte.value = 0
    await RisingEdge(dut.clk)
    await RisingEdge(dut.clk)
    dut.rst_n.value = 1
    await RisingEdge(dut.clk)

    # --- PHASE 2: SEND WEIGHT TILE (Opcode 0x01) ---
    print("\n[Sim] Injecting 0x01 Weight Tile Command payload stream...")
    for col in range(4):
        # Send Opcode Header
        dut.rx_byte.value = 0x01
        dut.rx_valid.value = 1
        await RisingEdge(dut.clk)
        
        # Stream the 4 column elements sequentially
        for row in range(4):
            dut.rx_byte.value = int(tile_B[row, col]) & 0xFF
            dut.rx_valid.value = 1
            await RisingEdge(dut.clk)
            
    dut.rx_valid.value = 0
    await RisingEdge(dut.clk)

    # --- PHASE 3: STREAM ACTIVATIONS WITH SKEW (Opcode 0x02) ---
    print("[Sim] Injecting 0x02 Activation Command skewed matrix stream...")
    for cycle in range(7):
        # Send Opcode Header
        dut.rx_byte.value = 0x02
        dut.rx_valid.value = 1
        await RisingEdge(dut.clk)
        
        # Calculate the diagonal clock skew row delay offsets
        v0 = tile_A[0] if cycle >= 0 and cycle < 4 else 0
        v1 = tile_A[1] if cycle >= 1 and cycle < 5 else 0
        v2 = tile_A[2] if cycle >= 2 and cycle < 6 else 0
        v3 = tile_A[3] if cycle >= 3 and cycle < 7 else 0
        
        # Feed the 4 parallel lane bytes sequentially to match FSM sub_index tracking
        for lane_val in [v0, v1, v2, v3]:
            dut.rx_byte.value = int(lane_val) & 0xFF
            dut.rx_valid.value = 1
            await RisingEdge(dut.clk)

    dut.rx_valid.value = 0
    print("Awaiting core processing execution completion...")
    
    # Wait max 100 cycles for the FSM execution done flag to cycle high
    timeout = 100
    while not dut.u_tpu_hardware_engine.done.value and timeout > 0:
        await RisingEdge(dut.clk)
        timeout -= 1

    assert timeout > 0, "❌ TIMEOUT ERROR: TPU Core engine never raised its execution done flag!"
    await RisingEdge(dut.clk)

    # --- PHASE 4: ASSERT RESULTS ---
    # Unpack the 128-bit output register into four signed 32-bit values
    raw_bits = str(dut.output_score_register.value)
    # Filter any uninitialized meta-states to zero
    clean_bits = "".join(['0' if c in 'xXzZ' else c for c in raw_bits])
    
    # Slice the raw binary chunk into 4 discrete 32-bit sub-words
    hardware_output = []
    for i in range(4):
        segment = clean_s = clean_bits[i*32 : (i+1)*32]
        val = int(segment, 2)
        # Handle 2's complement negative integers
        if val & (1 << 31):
            val -= (1 << 32)
        hardware_output.append(val)

    # Since the shifter packs LSB first, flip the list to line up with our column order
    hardware_output.reverse()
    print(f"\nPhysical Silicon Decoded Array: {hardware_output}")

    # Explicit verification check against CPU math reference
    for i in range(4):
        assert hardware_output[i] == golden_C[i], \
            f"❌ MATH MISMATCH! Col {i} returned {hardware_output[i]}, Expected reference score = {golden_C[i]}"

    print("\n📋 DECODER-TO-CORE INTEGRATION CHECK PASSED!")
