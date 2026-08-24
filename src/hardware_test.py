import os
import gzip
import time
import serial
import numpy as np

# --- 1. CONFIGURATION PARAMETERS ---
COM_PORT = 'COM9' 
BAUD_RATE = 3000000 
TOTAL_IMAGES_TO_TEST = 100  # Set to 100 for a rapid physical verification loop

# --- 2. LOCAL DATASETS LOADER BLOCKS ---
def load_local_mnist():
    print("Reading local MNIST training files...")
    try:
        with gzip.open("train-images-idx3-ubyte.gz", "rb") as f:
            X = np.frombuffer(f.read(), dtype=np.uint8, offset=16).reshape(-1, 784)
        with gzip.open("train-labels-idx1-ubyte.gz", "rb") as f:
            Y = np.frombuffer(f.read(), dtype=np.uint8, offset=8)
    except FileNotFoundError:
        raise FileNotFoundError("MNIST files not found! Ensure train_mnist.py was executed.")
    
    # Quantize entire pool to signed INT8 bounds (-128 to 127) for our hardware lanes
    X_quantized = np.round((X.astype(np.float32) / 255.0) * 127).astype(np.int8)
    return X_quantized, Y

def load_local_weights():
    if not os.path.exists("mnist_weights_int8.bin"):
        raise FileNotFoundError("Missing mnist_weights_int8.bin! Run train_mnist.py first.")
    with open("mnist_weights_int8.bin", "rb") as f:
        return np.frombuffer(f.read(), dtype=np.int8).reshape(784, 10)

# --- 3. HARDWARE DRIVE CORE ENGINE ---
def run_full_silicon_validation():
    X_test, Y_test = load_local_mnist()
    weights = load_local_weights()
    
    # Pad weights horizontally from 10 classes to 12 (multiple of 4) to align with 4x4 mesh
    W_padded = np.pad(weights.astype(np.int32), ((0, 0), (0, 2)), mode='constant', constant_values=0)
    
    print(f"\nOpening {COM_PORT} connection window at {BAUD_RATE} baud...")
    try:
        ser = serial.Serial(COM_PORT, baudrate=BAUD_RATE, timeout=1)
        ser.dtr = False
        ser.rts = False
        time.sleep(0.2)
        ser.reset_input_buffer()
        ser.reset_output_buffer()
    except serial.SerialException as e:
        print(f"❌ SERIAL DISCOVERY FAULT: {e}")
        return

    print(f"\n🚀 Initiating full physical evaluation across {TOTAL_IMAGES_TO_TEST} images...")
    hardware_correct_predictions = 0
    start_time = time.time()

    for idx in range(TOTAL_IMAGES_TO_TEST):
        image = X_test[idx]
        true_label = Y_test[idx]
        
        # Array to accumulate the 12 resulting predictions on our host system
        image_accumulators = np.zeros(12, dtype=np.int32)
        
        # --- PHYSICAL HARDWARE MATRIX TILING ENGINE ---
        # Step through the 12 output digit columns 4 lanes at a time
        for col_block in range(0, 12, 4):
            
            # Step down the 784 inner-product pixel dimensions 4 items at a time
            for inner_step in range(0, 784, 4):
                
                # 1. TRANSMIT WEIGHT TILE CHUNK (Opcode 0x01)
                tile_B = W_padded[inner_step:inner_step+4, col_block:col_block+4]
                for col in range(4):
                    weight_frame = bytearray([
                        0x01,
                        int(tile_B[0, col]) & 0xFF,
                        int(tile_B[1, col]) & 0xFF,
                        int(tile_B[2, col]) & 0xFF,
                        int(tile_B[3, col]) & 0xFF
                    ])
                    ser.write(weight_frame)
                ser.flush()
                
                # 2. STREAM ACTIVATION CHUNK WITH CLOCK SKEW (Opcode 0x02)
                tile_A = image[inner_step:inner_step+4]
                for cycle in range(7):
                    v0 = tile_A[0] if cycle >= 0 and cycle < 4 else 0
                    v1 = tile_A[1] if cycle >= 1 and cycle < 5 else 0
                    v2 = tile_A[2] if cycle >= 2 and cycle < 6 else 0
                    v3 = tile_A[3] if cycle >= 3 and cycle < 7 else 0
                    
                    activation_frame = bytearray([
                        0x02,
                        int(v0) & 0xFF,
                        int(v1) & 0xFF,
                        int(v2) & 0xFF,
                        int(v3) & 0xFF
                    ])
                    ser.write(activation_frame)
                ser.flush()
                
                # 3. BACK-CHANNEL RECEPTION WINDOW (Read 16 Bytes / 128 Bits)
                # On the 7th cycle, the FSM triggers tpu_uart_transmitter.sv to stream back
                # the 4 calculated 32-bit column sub-accumulators immediately.
                raw_back_bytes = ser.read(16)
                if len(raw_back_bytes) == 16:
                    tile_output = np.frombuffer(raw_back_bytes, dtype=np.int32)
                    # Accumulate the hardware sums into our global tracking matrix row
                    image_accumulators[col_block:col_block+4] += tile_output
                else:
                    print(f"⚠️ Communications Frame Timeout at image {idx}, step {inner_step}")
                    
        # Drop the 2 padding columns back down to extract our 10 real digit scores
        final_scores = image_accumulators[:10]
        predicted_digit = np.argmax(final_scores)
        
        if predicted_digit == true_label:
            hardware_correct_predictions += 1
            
        if (idx + 1) % 10 == 0:
            print(f"  Evaluated {idx + 1}/{TOTAL_IMAGES_TO_TEST} images via silicon...")

    # --- 4. SYSTEM PERFORMANCE AND ACCURACY ANALYSIS ---
    end_time = time.time()
    elapsed = end_time - start_time
    hardware_accuracy = (hardware_correct_predictions / TOTAL_IMAGES_TO_TEST) * 100
    
    print("\n================ FINAL SILICON METRICS ================")
    print(f"Total Test Batches:   {TOTAL_IMAGES_TO_TEST}")
    print(f"Correct TPU Matches:  {hardware_correct_predictions}")
    print(f"Physical FPGA Accuracy: {hardware_accuracy:.2f}%")
    print(f"Total Execution Time: {elapsed:.2f} seconds")
    print("=======================================================")

    # --- 5. END-TO-END QUALITY GATE CHECK ASSERTION ---
    MINIMUM_EXPECTED_ACCURACY = 88.0
    try:
        assert hardware_accuracy >= MINIMUM_EXPECTED_ACCURACY, \
            f"Pipeline Error! FPGA hit only {hardware_accuracy:.2f}%. Check RTL signal paths."
        print("\n📋 CORE HARDWARE PIPELINE CHECK PASSED!")
        print("🎉 Congratulations! Your custom physical Verilog TPU is fully functional across the wire!")
    except AssertionError as error:
        print(error)
        
    ser.close()

if __name__ == "__main__":
    run_full_silicon_validation()
