# TinyTPU — A TPU you can watch run

> Real 4×4 weight-stationary systolic array in synthesizable SystemVerilog, compiled to WebAssembly, running live in your browser. Every number on screen is a hardware signal — nothing is faked.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![RTL](https://img.shields.io/badge/RTL-SystemVerilog-blueviolet)](rtl/)
[![WASM](https://img.shields.io/badge/runtime-WebAssembly-654ff0)](wasm/)
[![Built with Astro](https://img.shields.io/badge/built%20with-Astro-ff5d01)](web/)

---

## Run it

**[→ Open the live visualizer](https://tiny-tpu.vercel.app)**

Enter two matrices. The browser runs the actual Verilog RTL (compiled to WASM) cycle-by-cycle and animates every PE, every activation, every partial sum — straight from the hardware signals.

---

## How it works

- **Real RTL** — `rtl/*.sv` is synthesizable SystemVerilog. `always_ff`/`always_comb` only. No delays, no initial blocks, no inferred latches. You can drop it into any FPGA synthesis flow.
- **Real WASM** — Verilator compiles the RTL to cycle-accurate C++. Emscripten compiles that C++ to WebAssembly. The browser runs the *compiled hardware*, not a JavaScript reimplementation of the math.
- **Real signals** — PE weights, activations, partial sums, and FSM phase are exposed via a stable debug output bus on `tiny_tpu_top`. The React island reads state directly from that bus — it does not fabricate any values.

```text
rtl/*.sv  ──▶  verilator --cc  ──▶  em++ -O3  ──▶  tiny_tpu.wasm
                                                        │
                                               React island reads
                                               live hardware state
                                               via embind API
```

### The hardware

A 4×4 weight-stationary systolic array computes `C = A · B` for signed int8 matrices in 14 clock cycles:

| Phase           | Cycles | What happens                                      |
| --------------- | ------ | ------------------------------------------------- |
| `LOAD_WEIGHTS`  | 4      | Matrix B loaded column-by-column into PE grid     |
| `STREAM`        | 7      | Matrix A streams from west edge with diagonal skew|
| `DRAIN`         | 3      | Final partial sums propagate to south edge        |

Each PE does one MAC per cycle: `psum_out <= psum_in + weight_reg × act_in`. The diagonal skew is the visual signature — row `i` of A is delayed `i` cycles so the right activation meets the right weight at the right clock edge.

For matrices larger than 4×4, the L3 view tiles the computation into multiple 4×4 passes. Each tile still runs on real RTL.

---

## Build from source

All RTL tooling runs inside **WSL2 Ubuntu**. The frontend runs anywhere.

### Prerequisites

```bash
# WSL2 Ubuntu
sudo apt-get install -y build-essential cmake python3 python3-pip python3-venv \
    autoconf flex bison libfl2 libfl-dev

# Verilator 5.x (from source)
git clone https://github.com/verilator/verilator && cd verilator
git checkout stable && autoconf && ./configure && make -j$(nproc) && sudo make install

# Emscripten
git clone https://github.com/emscripten-core/emsdk && cd emsdk
./emsdk install latest && ./emsdk activate latest
source emsdk_env.sh

# Python venv
python3 -m venv ~/.venvs/tinytpu && source ~/.venvs/tinytpu/bin/activate
pip install cocotb pytest numpy

# Node + pnpm
nvm install --lts && npm install -g pnpm
```

### RTL lint

```bash
verilator --lint-only -Wall rtl/*.sv
```

### Simulation (golden verification)

```bash
source ~/.venvs/tinytpu/bin/activate
pytest sim/golden.py -q
cd sim && make MODULE=test_top TOPLEVEL=tiny_tpu_top \
  VERILOG_SOURCES="../rtl/pe.sv ../rtl/systolic_array.sv ../rtl/controller.sv ../rtl/tiny_tpu_top.sv"
```

### WASM build

```bash
bash wasm/build.sh
# → web/public/tiny_tpu.mjs + web/public/tiny_tpu.wasm
```

### Frontend

```bash
cd web
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # production build
pnpm typecheck    # astro check + tsc --noEmit
```

---

## Why it's honest

Most hardware visualizers show a cartoon — a JavaScript reimplementation of the math with pretty animations on top. TinyTPU does the opposite:

1. **RTL is the single source of truth.** The frontend never reimplements the matmul. It reads state out of the compiled WASM binary.
2. **Golden-verified.** The cocotb test suite asserts bit-exact equality between RTL output and a numpy reference model for 20+ random matrix pairs before anything ships. A wrong matmul is a beautiful lie — TinyTPU refuses to tell it.
3. **No signal fabrication.** PE weights, activations, and partial sums come from a dedicated debug output bus on `tiny_tpu_top` — not from reconstructed state, not from a shadow model, not from `public_flat`.
4. **Synthesizable RTL.** The Verilog is not a testbench hack — it is the actual design, constrained to `always_ff`/`always_comb`, lint-clean under `-Wall`, and free of any simulation-only constructs.

---

## Monorepo layout

```text
tiny-tpu/
├── rtl/                 # SystemVerilog source of truth
│   ├── pe.sv            # MAC cell
│   ├── systolic_array.sv# 4×4 PE grid
│   ├── controller.sv    # FSM: LOAD_WEIGHTS → STREAM → DRAIN
│   ├── tiny_tpu_top.sv  # Top wrapper + debug output bus
│   └── README.md        # Signal dictionary + dataflow spec
├── sim/                 # cocotb verification
│   ├── golden.py        # numpy reference (ground truth)
│   ├── test_pe.py       # PE unit tests
│   ├── test_systolic_array.py
│   └── test_top.py      # full matmul + cycle count
├── wasm/                # C++ harness → WASM
│   ├── harness.cpp      # TinyTpuSim class, reads debug bus
│   ├── bindings.cpp     # embind surface
│   └── build.sh         # verilator + em++ build
├── web/                 # Astro + React + shadcn/ui
│   ├── src/pages/       # index.astro, app.astro, docs/
│   ├── src/components/  # Visualizer, PEGrid, Controls, MatrixInput
│   ├── src/lib/         # wasm-loader.ts, state-schema.ts
│   └── public/          # tiny_tpu.wasm (compiled artifact)
└── docs/
    └── STATE_SCHEMA.md  # Per-cycle state contract (sync with state-schema.ts)
```

---

## Docs

- [How it works](https://tiny-tpu.vercel.app/docs/how-it-works) — RTL→Verilator→WASM→browser pipeline
- [The systolic array](https://tiny-tpu.vercel.app/docs/the-systolic-array) — weight-stationary dataflow, skew, why TPUs use this
- [Architecture](https://tiny-tpu.vercel.app/docs/architecture) — monorepo layout, state contract, build decisions

---

## Roadmap

**v1 shipped:**

- 4×4 synthesizable systolic array, golden-verified
- Real-time WASM execution in browser
- L1 (single MAC) / L2 (full 4×4 grid) / L3 (tiling) progressive disclosure
- Full SEO, production deploy on Vercel

**Public iteration (build-in-public):**

- Configurable array size (N = 2..16)
- Challenge mode — score your MAC utilization vs optimal
- Dataflow modes — weight-stationary vs output-stationary toggle
- int8 quantization visualizer
- GPU-vs-TPU comparison view (cross-links TinyGPU)
- "Run a real `nn.Linear` layer" — the ML↔hardware bridge

---

## Collection

TinyTPU is entry #2 in the **Tiny** series — invisible systems, made watchable, with the real implementation underneath.

- **TinyGPU** — a minimal GPU in synthesizable RTL (entry #1)
- **TinyTPU** — this project

---

## License

MIT — see [LICENSE](LICENSE).

Built by [Deaneeth](https://github.com/deaneeth) · SystemVerilog · Verilator · Emscripten · Astro
