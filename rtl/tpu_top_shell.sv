module tpu_top_shell #(
    parameter CLK_FREQ  = 27000000,
    parameter BAUD_RATE = 3000000
)(
    input  wire       clk,
    input  wire       rst_n,
    input  wire       uart_rx,
    output wire       uart_tx,
    output wire [5:0] led       
);

    // --- INTERCONNECT NETS ---
    wire [7:0]   rx_byte;
    wire         rx_valid;
    
    wire         tpu_start;
    wire [31:0]  flat_a_in;
    wire [31:0]  flat_b_in;
    wire         tpu_done;
    wire [127:0] flat_c_out;
    wire [127:0] output_score_register;
    
    wire         tx_busy;
    reg          tpu_done_d1;
    reg          tx_trigger;

    // --- THE ACCURACY FIX: SECURE HARDWARE RESULT STORAGE ---
    reg [127:0] silicon_secured_scores;

    // Edge-triggered capture block locks calculation variables immediately
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            tpu_done_d1            <= 1'b0;
            tx_trigger             <= 1'b0;
            silicon_secured_scores <= 128'd0;
        end else begin
            tpu_done_d1 <= tpu_done;
            
            // Rising-edge detection check parameter
            if (tpu_done && !tpu_done_d1) begin
                tx_trigger             <= 1'b1; // Trigger UART transmission loop
                silicon_secured_scores <= output_score_register; // Freeze the scores safely!
            end else begin
                tx_trigger             <= 1'b0;
            end
        end
    end

    // Use our actual secured scores to drive the status indicators
    assign led = ~silicon_secured_scores[5:0];

    // --- SUBMODULE INSTANTIATIONS ---
    tpu_uart_receiver #(
        .CLK_FREQ(CLK_FREQ),
        .BAUD_RATE(BAUD_RATE)
    ) u_uart_rx (
        .clk(clk),
        .rst_n(rst_n),
        .uart_rx(uart_rx),
        .tpu_data(rx_byte),
        .tpu_valid(rx_valid)
    );

    // Pass the frozen 'silicon_secured_scores' to the transmitter, NOT the raw unstable wires
    tpu_uart_transmitter #(
        .CLK_FREQ(CLK_FREQ),
        .BAUD_RATE(BAUD_RATE)
    ) u_uart_tx (
        .clk(clk),
        .rst_n(rst_n),
        .tx_data(silicon_secured_scores),
        .tx_start(tx_trigger),
        .uart_tx(uart_tx),
        .tx_busy(tx_busy)
    );

    tpu_command_decoder u_cmd_decoder (
        .clk(clk),
        .rst_n(rst_n),
        .rx_byte(rx_byte),
        .rx_valid(rx_valid),
        .tpu_start(tpu_start),
        .flat_a_in(flat_a_in),
        .flat_b_in(flat_b_in),
        .tpu_done(tpu_done),
        .flat_c_out(flat_c_out),
        .output_score_register(output_score_register)
    );

    tpu_core_hardware_wrapper u_tpu_hardware_engine (
        .clk(clk),
        .rst_n(rst_n),
        .start(tpu_start),
        .flat_a_in(flat_a_in),
        .flat_b_in(flat_b_in),
        .done(tpu_done),
        .flat_c_out(flat_c_out)
    );

endmodule
