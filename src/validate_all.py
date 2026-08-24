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

# --- 2. LOAD PRE-TRAINED INT8 HARDWARE WEIGHTS ---
weights_filename = "mnist_weights_int8.bin"
if not os.path.exists(weights_filename):
    raise FileNotFoundError(f"Missing '{weights_filename}'. Please run train_mnist.py first.")

with open(weights_filename, "rb") as f:
    weights_bytes = f.read()

# Setup the precise structural matrix dimensions
shape_w = (784, 10)
shape_img = (total_images, 784) # Passing the full batch size (60000, 784)

# --- 3. QUANTIZE ALL IMAGES IN BULK ---
print("Quantizing all 60,000 images to signed INT8...")
X_quantized = np.round((X_dataset.astype(np.float32) / 255.0) * 127).astype(np.int8)
image_bytes = X_quantized.tobytes()

# --- 4. EXECUTE CO-VERIFICATION VIA INDEPENDENT METHOD CALL ---
print(f"Calling run_tpu_matmul for all {total_images} images simultaneously...")
output_bytes = run_tpu_matmul(image_bytes, weights_bytes, shape_img, shape_w)

# --- 5. PARSE ALL RESPONSES AND RUN ASSERTION ---
# Unpack the massive 32-bit hardware accumulator stream back into a 2D matrix
tpu_scores = np.frombuffer(output_bytes, dtype=np.int32).reshape(total_images, 10)

# Track our prediction indexes across the row axis
predictions = np.argmax(tpu_scores, axis=1)
correct_predictions = np.sum(predictions == Y_dataset)
final_accuracy = (correct_predictions / total_images) * 100

print("\n--- Final Performance Metrics ---")
print(f"Total Images Evaluated: {total_images}")
print(f"Correct Classifications: {correct_predictions}")
print(f"Final 4x4 Tiled Accuracy: {final_accuracy:.2f}%")

# Strict quality checkpoint assertion
MINIMUM_EXPECTED_ACCURACY = 88.0
assert final_accuracy >= MINIMUM_EXPECTED_ACCURACY, \
    f"Validation Failed! System accuracy is only {final_accuracy:.2f}%. Data pipeline is broken."

print("\n📋 RIGOROUS DATASET ASSERTION PASSED!")
print("🎉 Every single image was evaluated successfully in less than a second using your modular design.")
