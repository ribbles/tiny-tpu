import serial
import numpy as np
import tensorflow as tf

# 1. Connect to the Tang Nano 9K USB-C serial port
# (Check Device Manager or ls /dev/ to find your specific COM port)
ser = serial.Serial('COM3', baudrate=3000000, timeout=5)

def run_tpu_matmul(matrix_a, matrix_b):
    """
    Takes standard tensors, quantizes them to INT8, 
    and sends them across USB-C to the physical Verilog array.
    """
    # Cast/Quantize your framework tensors to raw 8-bit bytes
    a_bytes = matrix_a.numpy().astype(np.int8).tobytes()
    b_bytes = matrix_b.numpy().astype(np.int8).tobytes()
    
    # Send Command Protocol: OPCODE (0x03 for compute) + Matrix Data
    ser.write(b'\x03') 
    ser.write(a_bytes)
    ser.write(b_bytes)
    
    # Read back the 32-bit (4 byte) results from the hardware accumulators
    expected_output_size = matrix_a.shape[0] * matrix_b.shape[1] * 4
    raw_result = ser.read(expected_output_size)
    
    # Reconstruct the raw binary stream back into a standard Tensor
    result_array = np.frombuffer(raw_result, dtype=np.int32).reshape(matrix_a.shape[0], matrix_b.shape[1])
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
