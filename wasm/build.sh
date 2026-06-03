#!/usr/bin/env bash
# wasm/build.sh — Verilate TinyTPU RTL and compile to WASM via Emscripten.
#
# Usage (from project root):
#   bash wasm/build.sh
#
# Outputs:
#   web/public/tiny_tpu.mjs
#   web/public/tiny_tpu.wasm
#
# Prerequisites:
#   - Verilator >=5.x   (verilator on PATH)
#   - Emscripten SDK    (emcc/em++ on PATH — activate emsdk first)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OBJ_DIR="$SCRIPT_DIR/obj_dir"
OUT_DIR="$PROJECT_ROOT/web/public"

RTL="$PROJECT_ROOT/rtl/pe.sv \
     $PROJECT_ROOT/rtl/systolic_array.sv \
     $PROJECT_ROOT/rtl/controller.sv \
     $PROJECT_ROOT/rtl/tiny_tpu_top.sv"

# ---------------------------------------------------------------------------
# Resolve VERILATOR_ROOT
# ---------------------------------------------------------------------------
VROOT="$(verilator --getenv VERILATOR_ROOT 2>/dev/null || true)"
if [ -z "$VROOT" ]; then
  VROOT="$(pkg-config --variable=includedir verilator 2>/dev/null \
           | xargs dirname 2>/dev/null || true)"
fi
if [ -z "$VROOT" ]; then
  VROOT="/usr/local/share/verilator"
fi
# Fallback: Debian/Ubuntu system install
if [ ! -f "$VROOT/include/verilated.h" ] && [ -f "/usr/share/verilator/include/verilated.h" ]; then
  VROOT="/usr/share/verilator"
fi
echo "[info] VERILATOR_ROOT = $VROOT"

# ---------------------------------------------------------------------------
# Step 1 — Generate Verilated C++ from RTL
# ---------------------------------------------------------------------------
echo "[1/2] Verilating RTL → C++ ..."
mkdir -p "$OBJ_DIR"

# shellcheck disable=SC2086
verilator --cc $RTL \
  --top-module tiny_tpu_top \
  --Mdir "$OBJ_DIR" \
  -Wall \
  -Wno-DECLFILENAME

echo "      Generated files in $OBJ_DIR"

# ---------------------------------------------------------------------------
# Step 2 — Compile to WASM via Emscripten
# ---------------------------------------------------------------------------
echo "[2/2] Compiling WASM with Emscripten ..."
mkdir -p "$OUT_DIR"

# Collect all Verilated model sources (excludes verilated.cpp / verilated_threads.cpp)
VSRCS=()
while IFS= read -r f; do
  VSRCS+=("$f")
done < <(find "$OBJ_DIR" -maxdepth 1 -name 'V*.cpp' | sort)

em++ -O3 -std=c++17 \
  -I "$OBJ_DIR" \
  -I "$VROOT/include" \
  -I "$VROOT/include/vltstd" \
  -DVL_IGNORE_UNKNOWN_ARCH \
  "$SCRIPT_DIR/bindings.cpp" \
  "${VSRCS[@]}" \
  "$VROOT/include/verilated.cpp" \
  "$VROOT/include/verilated_threads.cpp" \
  -lembind \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createTinyTpu \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s ENVIRONMENT='web,node' \
  -o "$OUT_DIR/tiny_tpu.mjs"

echo ""
echo "Build complete:"
echo "  $OUT_DIR/tiny_tpu.mjs"
echo "  $OUT_DIR/tiny_tpu.wasm"
ls -lh "$OUT_DIR/tiny_tpu.mjs" "$OUT_DIR/tiny_tpu.wasm"
