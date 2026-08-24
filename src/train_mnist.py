import os
import gzip
import requests
import numpy as np

# --- 1. DOWNLOAD AND LOAD MNIST DATASET VIA AWS MIRROR ---
def download_mnist():
    # Utilizing the highly stable Amazon AWS open mirror used by AI frameworks
    base_url = "https://ossci-datasets.s3.amazonaws.com/mnist/"
    files = {
        "X_train": "train-images-idx3-ubyte.gz",
        "Y_train": "train-labels-idx1-ubyte.gz"
    }
    
    # Adding a header mimics a Windows web browser so the server permits the download
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
    
    for name, filename in files.items():
        if not os.path.exists(filename):
            print(f"Downloading {filename} from AWS mirror...")
            response = requests.get(base_url + filename, headers=headers, stream=True)
            if response.status_code == 200:
                with open(filename, 'wb') as f:
                    f.write(response.content)
            else:
                raise Exception(f"Failed to download {filename}. HTTP Status: {response.status_code}")
            
    # Parse the raw binary idx format directly into NumPy arrays
    with gzip.open(files["X_train"], "rb") as f:
        X = np.frombuffer(f.read(), dtype=np.uint8, offset=16).reshape(-1, 784)
    with gzip.open(files["Y_train"], "rb") as f:
        Y = np.frombuffer(f.read(), dtype=np.uint8, offset=8)
        
    return X, Y

print("Loading dataset...")
X_raw, Y_raw = download_mnist()

# Normalize dataset pixels to float values between 0.0 and 1.0
X_train = X_raw.astype(np.float32) / 255.0

# Convert scalar labels (0-9) into 10-column One-Hot encoded vectors
Y_train = np.eye(10)[Y_raw]

# --- 2. TRAIN THE NETWORK IN PURE NUMPY ---
np.random.seed(42)
weights = np.random.randn(784, 10) * 0.01  
learning_rate = 0.1
epochs = 5
batch_size = 100

print("Training model via pure NumPy...")
num_samples = X_train.shape[0]

for epoch in range(epochs):
    permutation = np.random.permutation(num_samples)
    X_shuffled = X_train[permutation]
    Y_shuffled = Y_train[permutation]
    
    for i in range(0, num_samples, batch_size):
        x_batch = X_shuffled[i : i + batch_size]
        y_true = Y_shuffled[i : i + batch_size]
        
        # Forward pass: Core Matrix Multiplication (Y = X * W)
        y_pred = np.dot(x_batch, weights)
        
        # Softmax activation function
        exp_scores = np.exp(y_pred - np.max(y_pred, axis=1, keepdims=True))
        probs = exp_scores / np.sum(exp_scores, axis=1, keepdims=True)
        
        # Backward pass: Calculate gradients
        loss_grad = (probs - y_true) / batch_size
        weights_grad = np.dot(x_batch.T, loss_grad)
        
        # Update weights
        weights -= learning_rate * weights_grad
        
    # Evaluate accuracy
    test_scores = np.dot(X_train, weights)
    predictions = np.argmax(test_scores, axis=1)
    accuracy = np.mean(predictions == Y_raw) * 100
    print(f"Epoch {epoch+1}/{epochs} - Accuracy: {accuracy:.2f}%")

print("Training complete!")

# --- 3. QUANTIZE WEIGHTS FOR YOUR VERILOG TPU ---
max_val = np.max(np.abs(weights))
quantized_weights = np.round((weights / max_val) * 127).astype(np.int8)

# Save the weights to a file (Exactly 7,840 bytes)
quantized_weights.tofile("mnist_weights_int8.bin")
print("Successfully exported 'mnist_weights_int8.bin' (7,840 bytes) for FPGA.")
