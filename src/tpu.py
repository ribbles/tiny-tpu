import serial
import numpy as np
import tensorflow as tf

try:
    from unified_shell import run_unified_matmul
except ModuleNotFoundError:
    from src.unified_shell import run_unified_matmul

# 1. Connect to the Tang Nano 9K USB-C serial port
# (Check Device Manager or ls /dev/ to find your specific COM port)
ser = serial.Serial('COM3', baudrate=3000000, timeout=5)

def run_tpu_matmul(matrix_a, matrix_b):
    """
    Tile a host-side matmul over the current 0x03 shell protocol.
    """
    result_array = run_unified_matmul(
        ser,
        matrix_a.numpy().astype(np.int8),
        matrix_b.numpy().astype(np.int8),
    )
    return tf.convert_to_tensor(result_array, dtype=tf.int32)

# --- Standard TensorFlow/Keras Inference Step ---
# Load a real image from an out-of-the-box dataset like MNIST
(x_train, y_train), _ = tf.keras.datasets.mnist.load_data()
sample_image = x_train[0].flatten().reshape(1, 784) # Example vector

# Standard extracted layer weights from a pre-trained Keras model
mock_weights = np.random.randint(-5, 5, size=(784, 8)) 

# Intercept and pass to your physical hardware!
tpu_output = run_tpu_matmul(tf.convert_to_tensor(sample_image), tf.convert_to_tensor(mock_weights))
print("Result computed entirely by Tang Nano 9K over USB-C:", tpu_output)
