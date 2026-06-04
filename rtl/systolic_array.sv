// systolic_array.sv - 4×4 weight-stationary systolic array
//
// Dataflow summary
// ----------------
// Matrix B is pre-loaded as stationary weights: PE[i][j] holds B[i][j].
// Matrix A enters from the LEFT edge (act_west[i] = A row i, one row per row-PE).
// Activations travel RIGHT through each row (registered 1 cycle per hop).
// Partial sums start at 0 on the TOP edge and accumulate DOWNWARD.
// Results C[i][j] emerge from the BOTTOM edge (psum_south[j]) after skewed drain.
//
// Weight-loading scheme (column-by-column, N cycles)
// ---------------------------------------------------
// Assert load_weight=1 for exactly N consecutive cycles.
// Each cycle k (0-based), weight_col[i] carries B[i][k].
// An internal one-hot shift register (load_col_oh) gates load_weight so that
// only column k PEs capture their weight on cycle k.  The shift register resets
// to bit-0-hot and rotates left each load cycle → col 0, 1, 2, ..., N-1.
//
// Activation skew (applied by the controller, NOT this module)
// ------------------------------------------------------------
// Row i of A must be delayed i cycles relative to row 0 before entering act_west,
// so the correct A element meets the correct weight at each PE simultaneously.
// This module connects the left edge directly; the diagonal stagger is the
// controller's responsibility (see controller.sv).
//
// Debug bundle layout  (see rtl/README.md for the full field dictionary)
// -----------------------------------------------------------------------
// dbg_weight[i][j] = weight_reg of PE[row i, col j]
// dbg_act   [i][j] = act_out   of PE[row i, col j]  (activation passed right)
// dbg_psum  [i][j] = psum_out  of PE[row i, col j]  (partial sum passed down)
// actIn for PE[i][j] is derived as: (j==0) ? act_west[i] : dbg_act[i][j-1]

`default_nettype none

module systolic_array #(
    parameter int N      = 4,   // array dimension (N×N PEs)
    parameter int DATA_W = 8,   // signed activation / weight width (bits)
    parameter int ACC_W  = 32   // signed accumulator width (bits)
) (
    input  logic clk,
    input  logic rst_n,

    // Weight loading: drive load_weight=1 for N cycles with weight_col[i]=B[i][col].
    input  logic                     load_weight,
    input  logic signed [DATA_W-1:0] weight_col [N],  // one column of B per cycle

    // Left-edge activations entering this cycle (row-skewed by the controller)
    input  logic signed [DATA_W-1:0] act_west [N],

    // Bottom-edge results (one per column); valid after the drain phase
    output logic signed [ACC_W-1:0]  psum_south [N],

    // Debug bundle - all PE state for the top-level debug bus (row-major [i][j])
    output logic signed [DATA_W-1:0] dbg_weight [N][N],
    output logic signed [DATA_W-1:0] dbg_act    [N][N],  // act_out per PE
    output logic signed [ACC_W-1:0]  dbg_psum   [N][N]   // psum_out per PE
);

    // -----------------------------------------------------------------------
    // Column selector: one-hot shift register.
    // Bit k is hot → PEs in column k load their weight this cycle.
    // Reset: bit 0 hot (ready for col 0 on the first load cycle).
    // Rotate: MSB wraps to LSB each load cycle (col 0→1→2→3→0→…).
    // -----------------------------------------------------------------------
    logic [N-1:0] load_col_oh;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            load_col_oh <= N'(1);   // bit 0 hot = column 0
        else if (load_weight)
            load_col_oh <= {load_col_oh[N-2:0], load_col_oh[N-1]};  // rotate left
    end

    // -----------------------------------------------------------------------
    // Internal wiring arrays.
    // act_h [i][j] : activation VALUE arriving at PE[i][j] from the left.
    //   j == 0 → act_west[i] (left-edge input)
    //   j >  0 → act_out of PE[i][j-1] (registered by that PE)
    // psum_v[i][j] : partial sum arriving at PE[i][j] from above.
    //   i == 0 → 0 (top-edge boundary condition)
    //   i >  0 → psum_out of PE[i-1][j] (registered by that PE)
    // -----------------------------------------------------------------------
    logic signed [DATA_W-1:0] act_h  [N][N+1];  // [row][0..N], N+1 column slots
    logic signed [ACC_W-1:0]  psum_v [N+1][N];  // [0..N row slots][col]

    // Left-edge wire
    for (genvar i = 0; i < N; i++) begin : g_west
        assign act_h[i][0] = act_west[i];
    end

    // Top-edge zeros
    for (genvar j = 0; j < N; j++) begin : g_top
        assign psum_v[0][j] = '0;
    end

    // Bottom-edge outputs
    for (genvar j = 0; j < N; j++) begin : g_south
        assign psum_south[j] = psum_v[N][j];
    end

    // -----------------------------------------------------------------------
    // PE grid  (N×N generate loop)
    // -----------------------------------------------------------------------
    for (genvar i = 0; i < N; i++) begin : g_row
        for (genvar j = 0; j < N; j++) begin : g_col

            pe #(
                .DATA_W(DATA_W),
                .ACC_W (ACC_W)
            ) u_pe (
                .clk        (clk),
                .rst_n      (rst_n),
                // Only column j loads when the one-hot selector has bit j set
                .load_weight(load_weight & load_col_oh[j]),
                .weight_in  (weight_col[i]),
                .act_in     (act_h[i][j]),
                .psum_in    (psum_v[i][j]),
                .act_out    (act_h[i][j+1]),
                .psum_out   (psum_v[i+1][j]),
                .dbg_weight (dbg_weight[i][j])
            );

            // Debug taps alias the same wires already driven by the PE ports
            assign dbg_act [i][j] = act_h [i][j+1];
            assign dbg_psum[i][j] = psum_v[i+1][j];

        end
    end

endmodule

`default_nettype wire
