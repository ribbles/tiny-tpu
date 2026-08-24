module tpu_core_hardware_wrapper (
    input  wire         clk,
    input  wire         rst_n,
    input  wire         start,
    
    // Flat 1D data vectors bypass all synthesis port array errors
    input  wire [31:0]  flat_a_in,   // 4 lanes * 8 bits = 32 bits
    input  wire [31:0]  flat_b_in,   // 4 lanes * 8 bits = 32 bits
    
    output wire         done,
    output wire [127:0] flat_c_out   // Captured result row: 4 lanes * 32 bits = 128 bits
);

    reg signed [7:0]   ctrl_a_in [3:0][3:0];
    reg signed [7:0]   ctrl_b_in [3:0][3:0];
    wire signed [31:0] core_c_buf [3:0];
    reg signed [31:0]  result_row [3:0];

    wire               load_weight;
    wire signed [7:0]  w_col [3:0];
    wire signed [7:0]  a_west [3:0];
    wire [2:0]         stream_cyc;
    wire [1:0]         drain_cyc;
    wire [2:0]         fsm_state;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (int r = 0; r < 4; r++) begin
                for (int c = 0; c < 4; c++) begin
                    ctrl_a_in[r][c] <= 8'd0;
                    ctrl_b_in[r][c] <= 8'd0;
                end
                result_row[r] <= 32'd0;
            end
        end else if (start) begin
            for (int r = 0; r < 4; r++) begin
                for (int c = 0; c < 4; c++) begin
                    ctrl_a_in[r][c] <= 8'd0;
                    ctrl_b_in[r][c] <= 8'd0;
                end
                result_row[r] <= 32'd0;
            end

            // Transpose the 1x4 activation row into the controller's A^T storage.
            ctrl_a_in[0][0] <= flat_a_in[7:0];
            ctrl_a_in[1][0] <= flat_a_in[15:8];
            ctrl_a_in[2][0] <= flat_a_in[23:16];
            ctrl_a_in[3][0] <= flat_a_in[31:24];

            // Store the 1x4 weight row in natural order.
            ctrl_b_in[0][0] <= flat_b_in[7:0];
            ctrl_b_in[0][1] <= flat_b_in[15:8];
            ctrl_b_in[0][2] <= flat_b_in[23:16];
            ctrl_b_in[0][3] <= flat_b_in[31:24];
        end else begin
            // Row 0 drains out in reverse column order. The final column-0 value
            // becomes readable one cycle after the controller raises done.
            if ((fsm_state == 3'd3) && (drain_cyc == 2'd0))
                result_row[3] <= core_c_buf[3];
            if ((fsm_state == 3'd3) && (drain_cyc == 2'd1))
                result_row[2] <= core_c_buf[2];
            if ((fsm_state == 3'd3) && (drain_cyc == 2'd2))
                result_row[1] <= core_c_buf[1];
            if (done)
                result_row[0] <= core_c_buf[0];
        end
    end

    assign flat_c_out[31:0]    = result_row[0];
    assign flat_c_out[63:32]   = result_row[1];
    assign flat_c_out[95:64]   = result_row[2];
    assign flat_c_out[127:96]  = result_row[3];

    controller u_ctrl (
        .clk(clk),
        .rst_n(rst_n),
        .start(start),
        .a_buf(ctrl_a_in),
        .b_buf(ctrl_b_in),
        .load_weight(load_weight),
        .weight_col(w_col),
        .act_west(a_west),
        .stream_cyc_out(stream_cyc),
        .drain_cyc_out(drain_cyc),
        .fsm_state(fsm_state),
        .done(done)
    );

    systolic_array u_array (
        .clk(clk),
        .rst_n(rst_n),
        .load_weight(load_weight),
        .weight_col(w_col),
        .act_west(a_west),
        .psum_south(core_c_buf)
    );

endmodule
