module tpu_command_decoder (
    input  wire         clk,
    input  wire         rst_n,
    
    // Interface from UART Receiver
    input  wire [7:0]   rx_byte,
    input  wire         rx_valid,
    
    // Interface to Hardware TPU Engine
    output reg          tpu_start,
    output reg  [31:0]  flat_a_in,
    output reg  [31:0]  flat_b_in,
    input  wire         tpu_done,
    input  wire [127:0] flat_c_out,
    
    // System Output
    output reg  [127:0] output_score_register
);

    // --- FSM STATES ---
    localparam STATE_IDLE      = 2'b00;
    localparam STATE_UNIFIED   = 2'b01;
    localparam STATE_RUN_CORE  = 2'b10;
    localparam STATE_WAIT_OUT  = 2'b11;

    reg [1:0] state;
    reg [4:0] sub_index; // 5 bits to count from 0 to 31 (32 bytes total)

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state                  <= STATE_IDLE;
            sub_index              <= 5'd0;
            tpu_start              <= 1'b0;
            flat_a_in              <= 32'd0;
            flat_b_in              <= 32'd0;
            output_score_register  <= 128'd0;
        end else begin
            tpu_start <= 1'b0; // Default auto-clear single cycle pulse

            case (state)
                STATE_IDLE: begin
                    sub_index <= 5'd0;
                    if (rx_valid && (rx_byte == 8'h03)) begin // Opcode 0x03: Unified Compute Block
                        flat_a_in <= 32'd0;
                        flat_b_in <= 32'd0;
                        state <= STATE_UNIFIED;
                    end
                end

                STATE_UNIFIED: begin
                    if (rx_valid) begin
                        // The shell currently forwards a single 1x4 activation row and a
                        // single 1x4 weight row into the hardware wrapper. Latch only the
                        // first row of each 4x4 block and ignore the padded rows.
                        case (sub_index)
                            5'd0:  flat_b_in[7:0]   <= rx_byte;
                            5'd1:  flat_b_in[15:8]  <= rx_byte;
                            5'd2:  flat_b_in[23:16] <= rx_byte;
                            5'd3:  flat_b_in[31:24] <= rx_byte;
                            5'd16: flat_a_in[7:0]   <= rx_byte;
                            5'd17: flat_a_in[15:8]  <= rx_byte;
                            5'd18: flat_a_in[23:16] <= rx_byte;
                            5'd19: flat_a_in[31:24] <= rx_byte;
                            default: begin
                            end
                        endcase

                        if (sub_index == 5'd31) begin
                            tpu_start <= 1'b1; // Trigger both fields simultaneously!
                            state     <= STATE_RUN_CORE;
                        end else begin
                            sub_index <= sub_index + 1'b1;
                        end
                    end
                end

                STATE_RUN_CORE: begin
                    if (tpu_done) begin
                        state <= STATE_WAIT_OUT;
                    end
                end

                STATE_WAIT_OUT: begin
                    output_score_register <= flat_c_out;
                    state                 <= STATE_IDLE;
                end

                default: state <= STATE_IDLE;
            endcase
        end
    end

endmodule
