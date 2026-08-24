module tpu_core_hardware_wrapper (
    input  wire         clk,
    input  wire         rst_n,
    input  wire         start,
    
    // Flat 1D data vectors bypass all synthesis port array errors
    input  wire [31:0]  flat_a_in,   // 4 lanes * 8 bits = 32 bits
    input  wire [31:0]  flat_b_in,   // 4 lanes * 8 bits = 32 bits
    
    output wire         done,
    output wire [127:0] flat_c_out   // 4 lanes * 32 bits = 128 bits
);

    // --- 1. INTERNAL MATRIX SIGNALS ---
    wire [7:0]  ctrl_a_in [3:0];
    wire [7:0]  ctrl_b_in [3:0];
    wire [31:0] core_c_buf [3:0];
    
    wire        load_weight;
    wire [7:0]  w_col [3:0];
    wire [7:0]  a_west [3:0];

    // Unused debug monitor registers required by your module signature
    wire [2:0]  unused_stream_cyc;
    wire [1:0]  unused_drain_cyc;
    wire [2:0]  unused_fsm_state;

    // --- 2. BIT SLICING EXTRACTIONS ---
    assign ctrl_a_in[0] = flat_a_in[7:0];
    assign ctrl_a_in[1] = flat_a_in[15:8];
    assign ctrl_a_in[2] = flat_a_in[23:16];
    assign ctrl_a_in[3] = flat_a_in[31:24];

    assign ctrl_b_in[0] = flat_b_in[7:0];
    assign ctrl_b_in[1] = flat_b_in[15:8];
    assign ctrl_b_in[2] = flat_b_in[23:16];
    assign ctrl_b_in[3] = flat_b_in[31:24];

    assign flat_c_out[31:0]    = core_c_buf[0];
    assign flat_c_out[63:32]   = core_c_buf[1];
    assign flat_c_out[95:64]   = core_c_buf[2];
    assign flat_c_out[127:96]  = core_c_buf[3];

    // --- 3. SUBMODULE INSTANTIATIONS ---
    // Mapping the 1D lanes into the 2D matrix rows using SystemVerilog multi-level array literals
    controller u_ctrl (
        .clk(clk),
        .rst_n(rst_n),
        .start(start),
        .a_buf('{ctrl_a_in, ctrl_a_in, ctrl_a_in, ctrl_a_in}), // Form 2D array literal structure
        .b_buf('{ctrl_b_in, ctrl_b_in, ctrl_b_in, ctrl_b_in}), // Form 2D array literal structure
        .load_weight(load_weight),
        .weight_col(w_col),
        .act_west(a_west),
        .stream_cyc_out(unused_stream_cyc),
        .drain_cyc_out(unused_drain_cyc),
        .fsm_state(unused_fsm_state),
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
