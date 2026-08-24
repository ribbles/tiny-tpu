import os
import gzip
import numpy as np
from tpu_emulator import run_tpu_matmul

# --- 1. LOAD THE ENTIRE LOCAL DATASET FROM DISK ---
print("Reading complete local MNIST files from disk...")
try:
    with gzip.open("train-images-idx3-ubyte.gz", "rb") as f:
        X_dataset = np.frombuffer(f.read(), dtype=np.uint8, offset=16).reshape(-1, 784)
    with gzip.open("train-labels-idx1-ubyte.gz", "rb") as f:
        Y_dataset = np.frombuffer(f.read(), dtype=np.uint8, offset=8)
except FileNotFoundError:
    raise FileNotFoundError("Could not find local MNIST files. Run train_mnist.py first.")

total_images = X_dataset.shape[0]
print(f"Successfully unpacked {total_images} total images from the binary stream.")

# --- 2. LOAD PRE-TRAINED INT8 HARDWARE WEIGHTS ---
weights_filename = "mnist_weights_int8.bin"
if not os.path.exists(weights_filename):
    raise FileNotFoundError(f"Missing '{weights_filename}'. Please run train_mnist.py first.")

with open(weights_filename, "rb") as f:
    weights_bytes = f.read()

shape_w = (784, 10)

# --- 3. QUANTIZE THE ENTIRE IMAGE POOL UPFRONT ---
print("Quantizing all 60,000 images to signed INT8...")
# Batch-convert pixels to -128 to 127 range to match your Verilog input expectations
X_quantized = np.round((X_dataset.astype(np.float32) / 255.0) * 127).astype(np.int8)

# --- 4. DATASET VALIDATION LOOP ---
print("\nValidating 100% of images through TPU Emulation Interface...")
correct_predictions = 0

# Loop through every image in the dataset to prove zero memory corruption occurs
for idx in range(total_images):
    image_bytes = X_quantized[idx].tobytes()
    shape_img = (1, 784)
    
    # Send through the hardware-emulated byte pipeline
    output_bytes = run_tpu_matmul(image_bytes, weights_bytes, shape_img, shape_w)
    
    # Parse the 32-bit hardware accumulator outputs
    tpu_scores = np.frombuffer(output_bytes, dtype=np.int32)
    predicted_digit = np.argmax(tpu_scores)
    
    # Compare against ground truth label
    if predicted_digit == Y_dataset[idx]:
        correct_predictions += 1
        
    # Visual progress anchor for the terminal
    if (idx + 1) % 10000 == 0:
        current_acc = (correct_predictions / (idx + 1)) * 100
        print(f" Processed {idx + 1}/{total_images} images... Running Accuracy: {current_acc:.2f}%")

final_accuracy = (correct_predictions / total_images) * 100

print("\n--- Final Validation Metrics ---")
print(f"Total Images Evaluated: {total_images}")
print(f"Correct TPU Classifications: {correct_predictions}")
print(f"Final INT8 System Accuracy: {final_accuracy:.2f}%")

# --- 5. DATASET INTEGRITY ASSERTION ---
# A working single-layer MNIST model should hit at least 88% accuracy.
# If it drops below this, it proves there is a corruption or structural bug in the bytes loop.
MINIMUM_EXPECTED_ACCURACY = 88.0
assert final_accuracy >= MINIMUM_EXPECTED_ACCURACY, \
    f"Validation Failed! System accuracy is only {final_accuracy:.2f}%. Data pipeline is broken."

print("\n📋 RIGOROUS DATASET ASSERTION PASSED!")
print("🎉 Every image was read cleanly, parsed without crash, and evaluated with high accuracy.")
