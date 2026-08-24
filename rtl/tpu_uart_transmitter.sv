module tpu_uart_transmitter #(
    parameter CLK_FREQ  = 27000000,
    parameter BAUD_RATE = 3000000
)(
    input  wire         clk,
    input  wire         rst_n,
    input  wire [127:0] tx_data,   // 128-bit full score array from the TPU
    input  wire         tx_start,  // 1-cycle pulse triggering transmission
    output reg          uart_tx,   // Physical TX pin routed to CH552 USB bridge
    output reg          tx_busy    // High while actively shifting data bytes
);

    localparam BIT_PERIOD = CLK_FREQ / BAUD_RATE;

    // FSM States
    localparam STATE_IDLE  = 2'b00;
    localparam STATE_START = 2'b01;
    localparam STATE_DATA  = 2'b10;
    localparam STATE_STOP  = 2'b11;

    reg [1:0]   state;
    reg [15:0]  clk_cnt;
    reg [2:0]   bit_cnt;
    reg [3:0]   byte_cnt; // Tracks which of the 16 bytes we are currently sending

    reg [127:0] tx_shift_reg;
    reg [7:0]   current_byte;

    // FSM Execution Core Loop
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state            <= STATE_IDLE;
            clk_cnt          <= 16'd0;
            bit_cnt          <= 3'd0;
            byte_cnt         <= 4'd0;
            tx_shift_reg     <= 128'd0;
            current_byte     <= 8'd0;
            uart_tx          <= 1'b1; // Idle state for UART line is High
            tx_busy          <= 1'b0;
        end else begin
            case (state)
                STATE_IDLE: begin
                    uart_tx <= 1'b1;
                    if (tx_start) begin
                        tx_shift_reg <= tx_data;
                        byte_cnt     <= 4'd0;
                        tx_busy      <= 1'b1;
                        state        <= STATE_START;
                    end else begin
                        tx_busy      <= 1'b0;
                    end
                end

                STATE_START: begin
                    uart_tx <= 1'b0; // Pull line low for Start bit
                    // Extract the next 8-bit chunk from our shift register
                    current_byte <= tx_shift_reg[7:0]; 
                    
                    if (clk_cnt == BIT_PERIOD - 1) begin
                        clk_cnt <= 16'd0;
                        bit_cnt <= 3'd0;
                        state   <= STATE_DATA;
                    end else begin
                        clk_cnt <= clk_cnt + 1'b1;
                    end
                end

                STATE_DATA: begin
                    uart_tx <= current_byte[bit_cnt]; // Standard LSB-first transmission
                    
                    if (clk_cnt == BIT_PERIOD - 1) begin
                        clk_cnt <= 16'd0;
                        if (bit_cnt == 3'd7) begin
                            state <= STATE_STOP;
                        end else begin
                            bit_cnt <= bit_cnt + 1'b1;
                        end
                    end else begin
                        clk_cnt <= clk_cnt + 1'b1;
                    end
                end

                STATE_STOP: begin
                    uart_tx <= 1'b1; // Drive line high for Stop bit
                    
                    if (clk_cnt == BIT_PERIOD - 1) begin
                        clk_cnt <= 16'd0;
                        if (byte_cnt == 4'd15) begin
                            state <= STATE_IDLE; // Sent all 16 bytes successfully
                        end else begin
                            byte_cnt     <= byte_cnt + 1'b1;
                            tx_shift_reg <= tx_shift_reg >> 8; // Shift down the next byte
                            state        <= STATE_START;       // Loop to transmit next byte
                        end
                    end else begin
                        clk_cnt <= clk_cnt + 1'b1;
                    end
                end

                default: state <= STATE_IDLE;
            endcase
        end
    end
endmodule
