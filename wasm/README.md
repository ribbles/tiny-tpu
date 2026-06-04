# wasm/ - Verilator C++ Harness → Emscripten → WASM

This directory bridges the SystemVerilog RTL and the browser frontend.

## Build

```bash
# From project root (WSL2 Ubuntu):
bash wasm/build.sh
```

Outputs land in `web/public/`:

```
web/public/tiny_tpu.mjs    # ES module loader (~47 KB)
web/public/tiny_tpu.wasm   # compiled RTL (~161 KB)
```

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Verilator | ≥ 5.x | `apt install verilator` |
| Emscripten | ≥ 3.x | [emsdk](https://emscripten.org/docs/getting_started/downloads.html) - activate before building |

Verify both are on PATH:

```bash
verilator --version
emcc --version
```

## How the Build Works

**Step 1 - Verilate:** `verilator --cc` translates the four RTL source files into
C++ inside `wasm/obj_dir/`. Verilator 5.x emits multiple `V*.cpp` files instead
of a single `__ALL.cpp`; the build script collects them all with a glob.

**Step 2 - Compile to WASM:** `em++` compiles `bindings.cpp` (which `#include`s
`harness.cpp`) together with all Verilated model sources and the Verilator runtime
(`verilated.cpp`, `verilated_threads.cpp`).

Key `em++` flags:

| Flag | Why |
|---|---|
| `-O3` | Full optimisation - keeps WASM small and fast |
| `-std=c++17` | Required by Verilator 5.x generated code |
| `-lembind` | Emscripten C++ bindings (embind) |
| `MODULARIZE=1` | Wraps module in a factory function (avoids global pollution) |
| `EXPORT_ES6=1` | Emits a proper ES module (`export default createTinyTpu`) |
| `EXPORT_NAME=createTinyTpu` | Name of the factory function imported by the frontend |
| `ALLOW_MEMORY_GROWTH=1` | Let the heap grow if the simulation needs it |
| `ENVIRONMENT='web,node'` | Target both browser and Node.js (needed for CI verification) |
| `-DVL_IGNORE_UNKNOWN_ARCH` | Suppresses Verilator arch-detection warnings under Emscripten |

## Source Files

| File | Role |
|---|---|
| `harness.cpp` | Owns `Vtiny_tpu_top`. Drives the clock, reads the debug output bus, and builds `CycleState` JS objects. |
| `bindings.cpp` | `EMSCRIPTEN_BINDINGS` block that exposes `TinyTpuSim` to JavaScript via embind. `#include`s `harness.cpp`. |
| `build.sh` | Reproduces the full build from source in two steps (Verilate → em++). |

## JS API

```js
import createTinyTpu from '/tiny_tpu.mjs';

const mod = await createTinyTpu();
const sim = new mod.TinyTpuSim();

sim.reset();
sim.loadA([/* 16 int8 values, row-major */]);
sim.loadB([/* 16 int8 values, row-major */]);
sim.start();

const states = sim.run();     // returns CycleState[] - see docs/STATE_SCHEMA.md
const result = sim.getResult(); // flat int32[16], row-major C = A @ B

sim.delete(); // free Emscripten heap object when done
```

## Rebuild After RTL Changes

Any change to `rtl/*.sv` requires a full rebuild:

```bash
bash wasm/build.sh
```

The build script re-runs `verilator --cc` from scratch every time, so `wasm/obj_dir/`
is always consistent with the current RTL.

After rebuilding, verify the output still bit-matches the numpy golden model:

```bash
# From project root
cd sim && pytest golden.py -q
cd sim && make MODULE=test_top TOPLEVEL=tiny_tpu_top \
  VERILOG_SOURCES="../rtl/pe.sv ../rtl/systolic_array.sv ../rtl/controller.sv ../rtl/tiny_tpu_top.sv"
```

## State Contract

The per-cycle `CycleState` object produced by `step()` / `run()` is defined in:

- `docs/STATE_SCHEMA.md` - canonical definition
- `web/src/lib/state-schema.ts` - TypeScript mirror

These two files **must stay in sync** with `harness.cpp`.
