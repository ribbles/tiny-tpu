// tiny_tpu_top.sv - Top-level wrapper: systolic_array + controller + I/O buffers
//
// Usage:
//   1. Set a_in[i][j] = A[i][j] and b_in[i][j] = B[i][j].
//   2. Pulse start=1 for one cycle.
//   3. Wait for done=1 (fires during the last drain cycle, 14 cycles after start
//      for a 4×4 array - matches golden.py expected_cycles()).
//   4. Read c_buf[i][j] = (A @ B)[i][j].
//
// Result capture timing:
//   The systolic array computes (a_buf^T @ B).  Storing a_buf[k][r] = A[r][k]
//   (A transposed) makes the array compute A @ B.
//
//   psum_south[j] carries C[r][j] at stream_cyc = r+j+(N-1)  (for r+j ≤ N-1)
//   and at drain_cyc = r+j-N  (for r+j ≥ N).
//   c_buf[r][j] is latched exactly once when its window opens.

`default_nettype none

module tiny_tpu_top #(
    parameter int N      = 4,
    parameter int DATA_W = 8,
    parameter int ACC_W  = 32
) (
    input  wire clk,
    input  wire rst_n,
    input  wire start,

    input  wire signed [DATA_W-1:0] a_in [N][N],
    input  wire signed [DATA_W-1:0] b_in [N][N],

    output logic signed [ACC_W-1:0]  c_buf [N][N],

    output logic done,

    // Debug output bus
    output logic [2:0]               dbg_fsm_state,
    output logic signed [DATA_W-1:0] dbg_weight [N][N],
    output logic signed [DATA_W-1:0] dbg_act    [N][N],
    output logic signed [ACC_W-1:0]  dbg_psum   [N][N],
    output logic signed [DATA_W-1:0] dbg_west   [N],
    output logic signed [ACC_W-1:0]  dbg_south  [N]
);

    // -----------------------------------------------------------------------
    // Input buffers (captured on start)
    // a_buf[k][r] = A[r][k]  (A transposed) → array computes A @ B
    // b_buf[i][j] = B[i][j]  (B stored normally)
    // -----------------------------------------------------------------------
    logic signed [DATA_W-1:0] a_buf [N][N];
    logic signed [DATA_W-1:0] b_buf [N][N];

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (int r = 0; r < N; r++)
                for (int k = 0; k < N; k++) begin
                    a_buf[k][r] <= '0;
                    b_buf[r][k] <= '0;
                end
        end else if (start) begin
            for (int r = 0; r < N; r++)
                for (int k = 0; k < N; k++) begin
                    a_buf[k][r] <= a_in[r][k];   // transpose A
                    b_buf[r][k] <= b_in[r][k];
                end
        end
    end

    // -----------------------------------------------------------------------
    // Controller
    // -----------------------------------------------------------------------
    logic                     load_weight;
    logic signed [DATA_W-1:0] weight_col    [N];
    logic signed [DATA_W-1:0] act_west      [N];
    logic [2:0]               stream_cyc;
    logic [1:0]               drain_cyc;

    controller #(.N(N), .DATA_W(DATA_W)) u_ctrl (
        .clk           (clk),
        .rst_n         (rst_n),
        .start         (start),
        .a_buf         (a_buf),
        .b_buf         (b_buf),
        .load_weight   (load_weight),
        .weight_col    (weight_col),
        .act_west      (act_west),
        .stream_cyc_out(stream_cyc),
        .drain_cyc_out (drain_cyc),
        .fsm_state     (dbg_fsm_state),
        .done          (done)
    );

    // -----------------------------------------------------------------------
    // Systolic array
    // -----------------------------------------------------------------------
    logic signed [ACC_W-1:0] psum_south [N];

    systolic_array #(.N(N), .DATA_W(DATA_W), .ACC_W(ACC_W)) u_array (
        .clk         (clk),
        .rst_n       (rst_n),
        .load_weight (load_weight),
        .weight_col  (weight_col),
        .act_west    (act_west),
        .psum_south  (psum_south),
        .dbg_weight  (dbg_weight),
        .dbg_act     (dbg_act),
        .dbg_psum    (dbg_psum)
    );

    // -----------------------------------------------------------------------
    // Result capture
    //
    // c_buf[r][j] = psum_south[j] captured when the effective stream/drain
    // cycle equals r + j + (N-1):
    //   STREAM: stream_cyc == r+j+(N-1)   for r+j <= N-1
    //   DRAIN:  drain_cyc  == r+j-N       for r+j >= N
    //
    // These are pre-posedge values of the controller counters (registered).
    // -----------------------------------------------------------------------
    localparam logic [2:0] STREAM_CAP_MAX = 3'(2*N - 2);  // 6
    localparam logic [1:0] DRAIN_CAP_MAX  = 2'(N - 2);    // 2

    logic in_stream, in_drain;
    assign in_stream = (dbg_fsm_state == 3'd2);  // ST_STREAM
    assign in_drain  = (dbg_fsm_state == 3'd3);  // ST_DRAIN

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            for (int r = 0; r < N; r++)
                for (int j = 0; j < N; j++)
                    c_buf[r][j] <= '0;
        end else begin
            for (int r = 0; r < N; r++) begin
                for (int j = 0; j < N; j++) begin
                    // psum_south[j] carries C[r][j] one cycle AFTER stream posedge
                    // T=r+N+j.  Capture using the PRE-edge counter value:
                    //   STREAM: stream_cyc == r+N+j, valid when r+j <= N-2
                    //   DRAIN:  drain_cyc  == r+j-(N-1), valid when r+j >= N-1 and r+j <= 2N-3
                    // C[N-1][N-1] is the lone element that falls one cycle after DRAIN ends;
                    // it is captured separately by the `done`-triggered clause below.
                    if (in_stream &&
                        (r + j) <= (N - 2) &&
                        stream_cyc == 3'(unsigned'(r + j + N))) begin
                        c_buf[r][j] <= psum_south[j];
                    end
                    if (in_drain &&
                        (r + j) >= (N - 1) &&
                        drain_cyc == 2'(unsigned'(r + j - (N - 1)))) begin
                        c_buf[r][j] <= psum_south[j];
                    end
                end
            end
            // One cycle after `done` fires (done pre-edge = 1, meaning last drain just
            // completed), psum_south[N-1] carries C[N-1][N-1] - the single element
            // whose capture window falls one cycle outside the drain phase.
            if (done)
                c_buf[N-1][N-1] <= psum_south[N-1];
        end
    end

    // -----------------------------------------------------------------------
    // Debug wires
    // -----------------------------------------------------------------------
    assign dbg_west  = act_west;
    assign dbg_south = psum_south;

    // Suppress unused-localparam warnings
    logic _unused;
    assign _unused = &{STREAM_CAP_MAX, DRAIN_CAP_MAX};

endmodule

`default_nettype wire
