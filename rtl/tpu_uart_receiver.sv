module tpu_uart_receiver #(
    parameter CLK_FREQ = 27000000, 
    parameter BAUD_RATE = 3000000  
)(
    input  wire       clk,
    input  wire       rst_n,
    input  wire       uart_rx,     
    output reg  [7:0] tpu_data,    
    output reg        tpu_valid    
);

    localparam BIT_PERIOD  = 16'd9; // 27MHz / 3Mbps = 9 cycles exactly
    localparam HALF_PERIOD = 16'd4; // Center point sampling index step

    localparam STATE_IDLE  = 2'b00;
    localparam STATE_START = 2'b01;
    localparam STATE_DATA  = 2'b10;
    localparam STATE_STOP  = 2'b11;

    reg [1:0]  state;
    reg [15:0] clk_cnt;
    reg [2:0]  bit_cnt;
    reg [7:0]  rx_shift;

    reg rx_sync_0, rx_sync_1;
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            rx_sync_0 <= 1'b1;
            rx_sync_1 <= 1'b1;
        end else begin
            rx_sync_0 <= uart_rx;
            rx_sync_1 <= rx_sync_0;
        end
    end

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state     <= STATE_IDLE;
            clk_cnt   <= 16'd0;
            bit_cnt   <= 3'd0;
            rx_shift  <= 8'd0;
            tpu_data  <= 8'd0;
            tpu_valid <= 1'b0;
        end else begin
            tpu_valid <= 1'b0; 

            case (state)
                STATE_IDLE: begin
                    clk_cnt <= 16'd0;
                    bit_cnt <= 3'd0;
                    if (rx_sync_1 == 1'b0) begin 
                        state <= STATE_START;
                    end
                end

                STATE_START: begin
                    if (clk_cnt == HALF_PERIOD) begin
                        if (rx_sync_1 == 1'b0) begin 
                            clk_cnt <= 16'd0;
                            state   <= STATE_DATA;
                        end else begin
                            state   <= STATE_IDLE; 
                        end
                    end else begin
                        clk_cnt <= clk_cnt + 1'b1;
                    end
                end

                STATE_DATA: begin
                    if (clk_cnt == BIT_PERIOD - 1'b1) begin
                        clk_cnt  <= 16'd0;
                        rx_shift <= {rx_sync_1, rx_shift[7:1]}; 
                        
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
                    if (clk_cnt == BIT_PERIOD - 1'b1) begin
                        clk_cnt <= 16'd0;
                        if (rx_sync_1 == 1'b1) begin 
                            tpu_data  <= rx_shift;
                            tpu_valid <= 1'b1;      
                        end
                        state <= STATE_IDLE;
                    end else begin
                        clk_cnt <= clk_cnt + 1'b1;
                    end
                end

                default: state <= STATE_IDLE;
            endcase
        end
    end
endmodule
