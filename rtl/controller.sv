// controller.sv — TinyTPU FSM: IDLE → LOAD_WEIGHTS → STREAM → DRAIN → IDLE
//
// Cycle breakdown for N=4 (matches golden.py expected_cycles()=14):
//   LOAD_WEIGHTS : 4 cycles   (load_cyc 0..3)
//   STREAM       : 7 cycles   (stream_cyc 0..6; row i active for cycs i..i+N-1)
//   DRAIN        : 3 cycles   (drain_cyc 0..2)
//   Total        : 14 cycles
//
// done is asserted combinatorially during the LAST drain cycle (drain_cyc==N-2).
// This makes done observable on the same posedge that captures the last result,
// so expected_cycles() = 14 measures cycles from start posedge to done posedge.
//
// Activation skew (diagonal stagger):
//   a_buf[i][k] stores A^T[i][k] = A[k][i].  Row i drives a_buf[i][stream_cyc-i]
//   when stream_cyc in [i, i+N-1], else 0.  With a_buf = A^T, the array computes
//   (a_buf)^T @ B = A @ B.  See tiny_tpu_top.sv for the transpose on load.

`default_nettype none

module controller #(
    parameter int N      = 4,
    parameter int DATA_W = 8
) (
    input  logic clk,
    input  logic rst_n,
    input  logic start,

    input  logic signed [DATA_W-1:0] a_buf [N][N],
    input  logic signed [DATA_W-1:0] b_buf [N][N],

    output logic                     load_weight,
    output logic signed [DATA_W-1:0] weight_col  [N],
    output logic signed [DATA_W-1:0] act_west    [N],

    // Exposed counters for result capture in tiny_tpu_top
    output logic [2:0]               stream_cyc_out,
    output logic [1:0]               drain_cyc_out,

    output logic [2:0]               fsm_state,
    output logic                     done
);

    localparam int LOAD_LAST   = N - 1;    // 3
    localparam int STREAM_LAST = 2*N - 2;  // 6
    localparam int DRAIN_LAST  = N - 2;    // 2

    typedef enum logic [2:0] {
        ST_IDLE         = 3'd0,
        ST_LOAD_WEIGHTS = 3'd1,
        ST_STREAM       = 3'd2,
        ST_DRAIN        = 3'd3
    } state_t;

    state_t     state;
    logic [1:0] load_cyc;
    logic [2:0] stream_cyc;
    logic [1:0] drain_cyc;

    // -----------------------------------------------------------------------
    // State and counter registers
    // -----------------------------------------------------------------------
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state      <= ST_IDLE;
            load_cyc   <= '0;
            stream_cyc <= '0;
            drain_cyc  <= '0;
        end else begin
            case (state)
                ST_IDLE: begin
                    load_cyc   <= '0;
                    stream_cyc <= '0;
                    drain_cyc  <= '0;
                    if (start) state <= ST_LOAD_WEIGHTS;
                end

                ST_LOAD_WEIGHTS: begin
                    if (load_cyc == LOAD_LAST[1:0]) begin
                        load_cyc <= '0;
                        state    <= ST_STREAM;
                    end else begin
                        load_cyc <= load_cyc + 2'd1;
                    end
                end

                ST_STREAM: begin
                    if (stream_cyc == STREAM_LAST[2:0]) begin
                        stream_cyc <= '0;
                        state      <= ST_DRAIN;
                    end else begin
                        stream_cyc <= stream_cyc + 3'd1;
                    end
                end

                ST_DRAIN: begin
                    if (drain_cyc == DRAIN_LAST[1:0]) begin
                        drain_cyc <= '0;
                        state     <= ST_IDLE;
                    end else begin
                        drain_cyc <= drain_cyc + 2'd1;
                    end
                end

                default: state <= ST_IDLE;
            endcase
        end
    end

    // -----------------------------------------------------------------------
    // Weight loading
    // -----------------------------------------------------------------------
    always_comb begin
        load_weight = (state == ST_LOAD_WEIGHTS);
        for (int i = 0; i < N; i++)
            weight_col[i] = (state == ST_LOAD_WEIGHTS) ? b_buf[i][load_cyc] : '0;
    end

    // -----------------------------------------------------------------------
    // Activation skew
    // -----------------------------------------------------------------------
    always_comb begin
        logic [1:0] col_idx;
        for (int i = 0; i < N; i++) begin
            col_idx = stream_cyc[1:0] - 2'(unsigned'(i));
            if (state == ST_STREAM &&
                stream_cyc >= 3'(unsigned'(i)) &&
                stream_cyc <= 3'(unsigned'(i + N - 1))) begin
                act_west[i] = a_buf[i][col_idx];
            end else begin
                act_west[i] = '0;
            end
        end
    end

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    assign stream_cyc_out = stream_cyc;
    assign drain_cyc_out  = drain_cyc;
    assign fsm_state      = state;
    // done is registered so it is stable (and c_buf fully settled) at the
    // FallingEdge after the posedge that completes the last drain cycle.
    logic done_r;
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) done_r <= 1'b0;
        else        done_r <= (state == ST_DRAIN) && (drain_cyc == DRAIN_LAST[1:0]);
    end
    assign done = done_r;

endmodule

`default_nettype wire
