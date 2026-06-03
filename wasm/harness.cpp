// harness.cpp — C++ driver for Vtiny_tpu_top
//
// Owns the Verilated model and translates RTL debug-bus signals into the
// per-cycle CycleState objects defined in docs/STATE_SCHEMA.md.
//
// Clock model
// -----------
// Each step() = one full clock period:
//   clk=0 → eval()   [combinational settle; pre-posedge reads happen here]
//   clk=1 → eval()   [posedge; flip-flops update; post-posedge reads happen here]
//
// Pre-posedge reads: dbg_fsm_state, dbg_west (these are combinational outputs
//   that change on the NEXT posedge, so reading them before the edge gives the
//   values that were active during this cycle).
// Post-posedge reads: dbg_weight, dbg_act, dbg_psum, dbg_south, done (registered
//   outputs that reflect the computation just completed).
//
// actIn derivation (see docs/STATE_SCHEMA.md)
// -------------------------------------------
// dbg_act[i][j] = act_out of PE[i][j] = registered act_in from this cycle.
// actIn[i][j] = (j==0) ? pre_west[i] : (int8_t)dbg_act[i][j-1]  (post-posedge)
//
// Harness-side cycle counters (h_stream_cyc_, h_drain_cyc_)
// ----------------------------------------------------------
// stream_cyc and drain_cyc are internal to the controller and not on the debug
// bus.  The harness mirrors them by applying the same increment/reset logic
// using the pre-posedge FSM state observed each step.  These counters are used
// solely to compute southOutputs[j].valid — no business logic.

#include "Vtiny_tpu_top.h"
#include "verilated.h"
#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <cstdint>
#include <memory>
#include <string>

using emscripten::val;

// ---------------------------------------------------------------------------
// Constants matching controller.sv
// ---------------------------------------------------------------------------
static constexpr int N           = 4;
static constexpr int STREAM_LAST = 2 * N - 2;  // 6
static constexpr int DRAIN_LAST  = N - 2;       // 2

static constexpr uint8_t ST_IDLE         = 0;
static constexpr uint8_t ST_LOAD_WEIGHTS = 1;
static constexpr uint8_t ST_STREAM       = 2;
static constexpr uint8_t ST_DRAIN        = 3;

static const char* fsmName(uint8_t s) noexcept {
    switch (s) {
        case ST_IDLE:         return "IDLE";
        case ST_LOAD_WEIGHTS: return "LOAD_WEIGHTS";
        case ST_STREAM:       return "STREAM";
        case ST_DRAIN:        return "DRAIN";
        default:              return "IDLE";
    }
}

// ---------------------------------------------------------------------------
// TinyTpuSim
// ---------------------------------------------------------------------------
class TinyTpuSim {
    std::unique_ptr<VerilatedContext> ctx_;
    std::unique_ptr<Vtiny_tpu_top>   top_;

    int     cycle_count_;
    int     h_stream_cyc_;   // mirrors pre-posedge controller stream_cyc
    int     h_drain_cyc_;    // mirrors pre-posedge controller drain_cyc

    // -----------------------------------------------------------------------
    // Clock helpers
    // -----------------------------------------------------------------------
    void clockLow() {
        top_->clk = 0;
        top_->eval();
    }

    void clockHigh() {
        top_->clk = 1;
        top_->eval();
    }

    // -----------------------------------------------------------------------
    // Advance harness-side counters to match the hardware.
    // Called AFTER each posedge with the PRE-posedge FSM state.
    // Mirrors exactly: stream_cyc/drain_cyc increment when their respective
    // FSM state was active going INTO the posedge, and reset on roll-over.
    // -----------------------------------------------------------------------
    void advanceCounters(uint8_t pre_fsm) noexcept {
        if (pre_fsm == ST_STREAM) {
            h_stream_cyc_ = (h_stream_cyc_ == STREAM_LAST) ? 0 : h_stream_cyc_ + 1;
        }
        if (pre_fsm == ST_DRAIN) {
            h_drain_cyc_ = (h_drain_cyc_ == DRAIN_LAST) ? 0 : h_drain_cyc_ + 1;
        }
        if (pre_fsm == ST_IDLE) {
            h_stream_cyc_ = 0;
            h_drain_cyc_  = 0;
        }
    }

    // -----------------------------------------------------------------------
    // Determine whether south output of column j carries a final result element
    // this cycle.  Uses pre-posedge FSM state and harness-side cycle counters.
    //
    // Derivation (matches tiny_tpu_top.sv result-capture always_ff):
    //
    //   STREAM capture: c_buf[r][j] latched when
    //       in_stream AND (r+j) <= N-2 AND stream_cyc == r+j+N
    //     ⟹ for column j, any r is valid, so: N+j <= pre_sc <= 2N-2
    //
    //   DRAIN capture: c_buf[r][j] latched when
    //       in_drain AND (r+j) >= N-1 AND drain_cyc == r+j-(N-1)
    //     ⟹ for column j: pre_dc <= j   (and pre_dc in [0, DRAIN_LAST])
    //
    //   DONE extra: C[N-1][N-1] latched one cycle AFTER done fires
    //     (hardware uses pre-posedge done=1 to trigger the capture).
    //     ⟹ column N-1 is valid when pre_done is true.
    // -----------------------------------------------------------------------
    static bool southValid(int j, uint8_t pre_fsm,
                           int pre_sc, int pre_dc,
                           bool pre_done) noexcept {
        if (pre_done && j == N - 1)        return true;   // C[N-1][N-1]
        if (pre_fsm == ST_STREAM)
            return (pre_sc >= N + j) && (pre_sc <= 2 * N - 2);
        if (pre_fsm == ST_DRAIN)
            return (pre_dc <= j);
        return false;
    }

    // -----------------------------------------------------------------------
    // Build the CycleState val from current hardware state.
    // Called after the posedge has fired (post-posedge reads).
    // -----------------------------------------------------------------------
    val buildCycleState(int cycle,
                        uint8_t pre_fsm, bool pre_done,
                        const int8_t pre_west[N],
                        int pre_sc, int pre_dc) {

        const bool done_now = (top_->done != 0);
        // Override fsmState to "DONE" on the cycle done asserts
        const char* fsm = done_now ? "DONE" : fsmName(pre_fsm);

        // --- pes[16] (row-major) ---
        val pes = val::array();
        for (int i = 0; i < N; i++) {
            for (int j = 0; j < N; j++) {
                // actIn[i][0] = west edge input this cycle (pre-posedge)
                // actIn[i][j] = act_out of PE[i][j-1] registered this posedge
                const int8_t act_in = (j == 0)
                    ? pre_west[i]
                    : static_cast<int8_t>(top_->dbg_act[i][j - 1]);

                val pe = val::object();
                pe.set("row",    i);
                pe.set("col",    j);
                pe.set("weight", static_cast<int>(static_cast<int8_t>(top_->dbg_weight[i][j])));
                pe.set("actIn",  static_cast<int>(act_in));
                pe.set("psum",   static_cast<int>(static_cast<int32_t>(top_->dbg_psum[i][j])));
                pe.set("active", (pre_fsm == ST_STREAM) && (act_in != 0));
                pes.call<void>("push", pe);
            }
        }

        // --- westInputs[N] ---
        val west_arr = val::array();
        for (int i = 0; i < N; i++)
            west_arr.call<void>("push", static_cast<int>(pre_west[i]));

        // --- southOutputs[N] ---
        val south_arr = val::array();
        for (int j = 0; j < N; j++) {
            val so = val::object();
            so.set("col",   j);
            so.set("value", static_cast<int>(static_cast<int32_t>(top_->dbg_south[j])));
            so.set("valid", southValid(j, pre_fsm, pre_sc, pre_dc, pre_done));
            south_arr.call<void>("push", so);
        }

        val state = val::object();
        state.set("cycle",        cycle);
        state.set("fsmState",     std::string(fsm));
        state.set("pes",          pes);
        state.set("westInputs",   west_arr);
        state.set("southOutputs", south_arr);
        state.set("done",         done_now);
        return state;
    }

    void initInputs() noexcept {
        top_->rst_n = 0;
        top_->start = 0;
        top_->clk   = 0;
        for (int i = 0; i < N; i++)
            for (int j = 0; j < N; j++) {
                top_->a_in[i][j] = 0;
                top_->b_in[i][j] = 0;
            }
        top_->eval();
    }

public:
    // -----------------------------------------------------------------------
    // Construction / destruction
    // -----------------------------------------------------------------------
    TinyTpuSim()
        : ctx_(std::make_unique<VerilatedContext>())
        , top_(std::make_unique<Vtiny_tpu_top>(ctx_.get(), "TOP"))
        , cycle_count_(0)
        , h_stream_cyc_(0)
        , h_drain_cyc_(0)
    {
        initInputs();
    }

    ~TinyTpuSim() { top_->final(); }

    // -----------------------------------------------------------------------
    // reset() — assert rst_n low for two clock cycles then release.
    // Resets all internal harness state.
    // -----------------------------------------------------------------------
    void reset() {
        top_->rst_n = 0;
        top_->start = 0;
        clockLow(); clockHigh();
        clockLow(); clockHigh();
        top_->rst_n  = 1;
        clockLow();
        cycle_count_  = 0;
        h_stream_cyc_ = 0;
        h_drain_cyc_  = 0;
    }

    // -----------------------------------------------------------------------
    // loadA / loadB — write matrices into a_in / b_in.
    // Accepts a flat JS array (or Int8Array) of N*N values in row-major order.
    // Values outside the int8 range are truncated to the low 8 bits.
    // -----------------------------------------------------------------------
    void loadA(const val& flat) {
        for (int i = 0; i < N; i++)
            for (int j = 0; j < N; j++)
                top_->a_in[i][j] = static_cast<uint8_t>(flat[i * N + j].as<int>());
    }

    void loadB(const val& flat) {
        for (int i = 0; i < N; i++)
            for (int j = 0; j < N; j++)
                top_->b_in[i][j] = static_cast<uint8_t>(flat[i * N + j].as<int>());
    }

    // -----------------------------------------------------------------------
    // start() — pulse the hardware start signal for one clock cycle.
    // This transitions the FSM from IDLE → LOAD_WEIGHTS.
    // Must be called after loadA/loadB and before step()/run().
    // Resets the cycle counter and harness-side sub-counters.
    // -----------------------------------------------------------------------
    void start() {
        top_->start  = 1;
        clockLow();
        clockHigh();               // posedge: IDLE → LOAD_WEIGHTS
        top_->start  = 0;
        clockLow();                // low phase ready for first step()
        cycle_count_  = 0;
        h_stream_cyc_ = 0;
        h_drain_cyc_  = 0;
    }

    // -----------------------------------------------------------------------
    // step() — advance one clock cycle and return its CycleState.
    //
    // Sampling strategy:
    //   Pre-posedge : dbg_fsm_state, dbg_west  (combinational, next-cycle after posedge)
    //   Post-posedge: dbg_weight, dbg_act, dbg_psum, dbg_south, done  (registered)
    // -----------------------------------------------------------------------
    val step() {
        // Low phase — combinational outputs settle from current FF state
        clockLow();

        const uint8_t pre_fsm  = static_cast<uint8_t>(top_->dbg_fsm_state);
        const bool    pre_done = (top_->done != 0);
        const int     pre_sc   = h_stream_cyc_;
        const int     pre_dc   = h_drain_cyc_;
        int8_t        pre_west[N];
        for (int i = 0; i < N; i++)
            pre_west[i] = static_cast<int8_t>(top_->dbg_west[i]);

        // Rising edge — flip-flops update
        clockHigh();

        // Mirror hardware counters for next call
        advanceCounters(pre_fsm);

        return buildCycleState(cycle_count_++, pre_fsm, pre_done,
                               pre_west, pre_sc, pre_dc);
    }

    // -----------------------------------------------------------------------
    // run() — step until done fires, then one extra cycle to allow
    // c_buf[N-1][N-1] to be captured (hardware latches it one cycle after
    // done asserts — see tiny_tpu_top.sv "if (done)" clause).
    // Returns a JS array of all CycleState objects.
    // -----------------------------------------------------------------------
    val run() {
        val states = val::array();
        // Safety bound: 4+7+3+1(done)+1(extra) = 16 per run, guard at 200
        for (int guard = 0; guard < 200; ++guard) {
            val s = step();
            states.call<void>("push", s);
            if (s["done"].as<bool>()) {
                // One extra step: c_buf[N-1][N-1] captured on this posedge
                states.call<void>("push", step());
                break;
            }
        }
        return states;
    }

    // -----------------------------------------------------------------------
    // getResult() — read c_buf as a flat row-major JS array of N*N int32s.
    // Call after run() (or after done fires and the extra step is taken).
    // -----------------------------------------------------------------------
    val getResult() const {
        val result = val::array();
        for (int i = 0; i < N; i++)
            for (int j = 0; j < N; j++)
                result.call<void>("push",
                    static_cast<int>(static_cast<int32_t>(top_->c_buf[i][j])));
        return result;
    }

    int getCycleCount() const noexcept { return cycle_count_; }
};
