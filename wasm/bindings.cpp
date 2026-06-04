// bindings.cpp - Emscripten embind glue for TinyTpuSim
//
// Exposes TinyTpuSim to JavaScript.  Return types that are emscripten::val
// pass through as plain JS objects/arrays matching the CycleState schema
// defined in docs/STATE_SCHEMA.md and web/src/lib/state-schema.ts.
//
// JS usage pattern:
//
//   const mod  = await createTinyTpu();
//   const sim  = new mod.TinyTpuSim();
//   sim.reset();
//   sim.loadA(flatInt8ArrayA);   // row-major, 16 elements
//   sim.loadB(flatInt8ArrayB);
//   sim.start();
//   const states = sim.run();    // CycleState[]
//   const result = sim.getResult(); // flat int32[16], row-major

#include "harness.cpp"
#include <emscripten/bind.h>

using namespace emscripten;

EMSCRIPTEN_BINDINGS(tiny_tpu) {
    class_<TinyTpuSim>("TinyTpuSim")
        .constructor<>()
        .function("reset",         &TinyTpuSim::reset)
        .function("loadA",         &TinyTpuSim::loadA)
        .function("loadB",         &TinyTpuSim::loadB)
        .function("start",         &TinyTpuSim::start)
        .function("step",          &TinyTpuSim::step)
        .function("run",           &TinyTpuSim::run)
        .function("getResult",     &TinyTpuSim::getResult)
        .function("getCycleCount", &TinyTpuSim::getCycleCount);
}
