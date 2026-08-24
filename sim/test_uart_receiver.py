import cocotb
from cocotb.triggers import Timer, RisingEdge
from cocotb.clock import Clock

async def transmit_uart_bit_stream(rx_pin, byte_val, bit_period_ns):
    """Helper module to toggle the physical RX wire line using UART protocols."""
    # 1. Start Bit (Pull line low)
    rx_pin.value = 0
    await Timer(bit_period_ns, units="ns")
    
    # 2. Data Bits (8 bits, standard LSB-first transmission)
    for i in range(8):
        rx_pin.value = (byte_val >> i) & 0x01
        await Timer(bit_period_ns, units="ns")
        
    # 3. Stop Bit (Return line high)
    rx_pin.value = 1
    await Timer(bit_period_ns, units="ns")

@cocotb.test()
async def test_uart_receiver_sampling(dut):
    """
    Simulates a 3 Mbps serial byte stream arriving on the physical RX pin 
    and checks if the clock dividers latch the bits cleanly.
    """
    # Start 27MHz system reference reference clock
    cocotb.start_soon(Clock(dut.clk, 37, unit="ns").start())
    
    # 3 Mbps bit period calculation: 1 sec / 3,000,000 bits = ~333.33 ns per bit
    BIT_PERIOD_NS = 333.33

    # Reset Module
    dut.rst_n.value = 0
    dut.uart_rx.value = 1
    await Timer(100, units="ns")
    dut.rst_n.value = 1
    await Timer(100, units="ns")

    # Target bytes to verify across transmission bounds
    test_payloads = [0x55, 0xAA, 0x01, 0x02, 0xFF]

    for byte_to_send in test_payloads:
        print(f"Streaming Byte 0x{byte_to_send:02X} down the virtual serial line...")
        
        # Fire transmission coroutine helper block
        cocotb.start_soon(transmit_uart_bit_stream(dut.uart_rx, byte_to_send, BIT_PERIOD_NS))
        
        # Await the receiver FSM output valid ready pulse line flag
        timeout = 500
        while not dut.tpu_valid.value and timeout > 0:
            await RisingEdge(dut.clk)
            timeout -= 1
            
        assert timeout > 0, "❌ TIMEOUT ERROR: UART Receiver never raised tpu_valid flag!"
        
        # Extract the value stored in the parallel data register output register
        latched_output = int(dut.tpu_data.value)
        print(f"Receiver parallel byte output register: 0x{latched_output:02X}")
        
        assert latched_output == byte_to_send, \
            f"❌ DATA CORRUPTION! Sent 0x{byte_to_send:02X}, but receiver latched 0x{latched_output:02X}"
            
        await RisingEdge(dut.clk) # Settle line

    print("\n📋 UART RECEIVER TIMING CHECK PASSED!")
