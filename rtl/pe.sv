// pe.sv - Weight-stationary Processing Element (single MAC cell)
//
// Each cycle:
//   psum_out <= psum_in + weight_reg * act_in   (accumulate)
//   act_out  <= act_in                           (pass activation right, registered)
//
// weight_reg is stationary: captured once when load_weight=1, held across all
// streaming cycles.  Reset (rst_n=0) clears all registered state.
//
// Debug outputs (dbg_weight) drive the top-level debug bus; act_out and
// psum_out are already ports, so no separate aliases needed for those.

`default_nettype none

module pe #(
    parameter int DATA_W = 8,   // signed activation / weight width (bits)
    parameter int ACC_W  = 32   // signed accumulator width (bits)
) (
    input  logic                     clk,
    input  logic                     rst_n,

    // Weight load
    input  logic                     load_weight,
    input  logic signed [DATA_W-1:0] weight_in,

    // Dataflow inputs
    input  logic signed [DATA_W-1:0] act_in,    // activation from the left
    input  logic signed [ACC_W-1:0]  psum_in,   // partial sum from above

    // Dataflow outputs (registered)
    output logic signed [DATA_W-1:0] act_out,   // activation to the right
    output logic signed [ACC_W-1:0]  psum_out,  // partial sum downward

    // Debug: exposes stationary weight for the top-level debug bus
    output logic signed [DATA_W-1:0] dbg_weight
);

    logic signed [DATA_W-1:0]   weight_reg;

    // Full-precision multiply: int8 × int8 → int16 (no truncation, no overflow
    // for the int8 range ±127 × ±127 = ±16129 < 2^15).
    // Declared as a wire so synthesis sees pure combinational logic; the result
    // is consumed inside the always_ff to update psum_out each cycle.
    logic signed [2*DATA_W-1:0] product;
    assign product    = weight_reg * act_in;

    // Expose stationary weight to debug bus (continuous)
    assign dbg_weight = weight_reg;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            weight_reg <= '0;
            act_out    <= '0;
            psum_out   <= '0;
        end else begin
            if (load_weight)
                weight_reg <= weight_in;

            act_out  <= act_in;
            // Sign-extend 16-bit product to ACC_W before accumulating.
            // For int8 inputs with a 4×4 array: max accumulated value is
            // 4 × 127 × 127 = 64 516, well within the int32 range.
            psum_out <= psum_in + ACC_W'(product);
        end
    end

endmodule

`default_nettype wire
