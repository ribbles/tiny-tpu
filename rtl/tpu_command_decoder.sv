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
    localparam STATE_IDLE      = 3'b000;
    localparam STATE_LOAD_B    = 3'b010;
    localparam STATE_STREAM_A  = 3'b011;
    localparam STATE_RUN_CORE  = 3'b100;

    reg [2:0] state;
    reg [1:0] sub_index;
    reg [2:0] stream_counter;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state                  <= STATE_IDLE;
            sub_index              <= 2'd0;
            stream_counter         <= 3'd0;
            tpu_start              <= 1'b0;
            flat_a_in              <= 32'd0;
            flat_b_in              <= 32'd0;
            output_score_register  <= 128'd0;
        end else begin
            tpu_start <= 1'b0; // Default auto-clear pulse flag

            case (state)
                STATE_IDLE: begin
                    sub_index      <= 2'd0;
                    stream_counter <= 3'd0;
                    if (rx_valid) begin
                        case (rx_byte)
                            8'h01:   state <= STATE_LOAD_B;
                            8'h02:   state <= STATE_STREAM_A;
                            default: state <= STATE_IDLE;
                        endcase
                    end
                end

                STATE_LOAD_B: begin
                    if (rx_valid) begin
                        case (sub_index)
                            2'd0: flat_b_in[7:0]   <= rx_byte;
                            2'd1: flat_b_in[15:8]  <= rx_byte;
                            2'd2: flat_b_in[23:16] <= rx_byte;
                            2'd3: flat_b_in[31:24] <= rx_byte;
                        endcase
                        
                        if (sub_index == 2'd3) begin
                            tpu_start <= 1'b1; 
                            state     <= STATE_IDLE;
                        end else begin
                            sub_index <= sub_index + 1'b1;
                        end
                    end
                end

                STATE_STREAM_A: begin
                    if (rx_valid) begin
                        case (sub_index)
                            2'd0: flat_a_in[7:0]   <= rx_byte;
                            2'd1: flat_a_in[15:8]  <= rx_byte;
                            2'd2: flat_a_in[23:16] <= rx_byte;
                            2'd3: flat_a_in[31:24] <= rx_byte;
                        endcase
                        
                        if (sub_index == 2'd3) begin
                            tpu_start <= 1'b1; 
                            sub_index <= 2'd0;
                            if (stream_counter == 3'd6) begin
                                state <= STATE_RUN_CORE;
                            end else begin
                                stream_counter <= stream_counter + 1'b1;
                            end
                        end else begin
                            sub_index <= sub_index + 1'b1;
                        end
                    end
                end

                STATE_RUN_CORE: begin
                    if (tpu_done) begin
                        output_score_register <= flat_c_out; 
                        state                 <= STATE_IDLE;
                    end
                end

                default: state <= STATE_IDLE;
            endcase
        end
    end

endmodule
