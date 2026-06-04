#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OBJ_DIR="$SCRIPT_DIR/obj_dir"

VROOT="$(verilator --getenv VERILATOR_ROOT)"
if [ -z "$VROOT" ]; then
  VROOT="$(pkg-config --variable=includedir verilator 2>/dev/null | xargs dirname 2>/dev/null || echo /usr/local/share/verilator)"
fi

echo "[1/2] Verilating counter.sv..."
verilator --cc --threads 1 "$PROJECT_ROOT/rtl/spike/counter.sv" --Mdir "$OBJ_DIR"

echo "[2/2] Compiling to WASM via Emscripten..."
em++ -O2 -std=c++17 \
  -DVL_IGNORE_UNKNOWN_ARCH \
  -I "$OBJ_DIR" \
  -I "$VROOT/include" \
  "$SCRIPT_DIR/harness.cpp" \
  "$OBJ_DIR"/V*.cpp \
  "$VROOT/include/verilated.cpp" \
  "$VROOT/include/verilated_threads.cpp" \
  -lembind \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORT_NAME=createTinyTpuSpike \
  -o "$SCRIPT_DIR/counter.mjs"

echo "Done - outputs: $SCRIPT_DIR/counter.mjs + counter.wasm"
echo "Serve with: cd $SCRIPT_DIR && python3 -m http.server 8080"
