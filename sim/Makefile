# Cocotb/Verilator simulation Makefile
#
# Default: run test_pe against the pe module.
# Override all three variables on the command line for other suites:
#
#   make MODULE=test_systolic_array TOPLEVEL=systolic_array \
#        VERILOG_SOURCES="../rtl/pe.sv ../rtl/systolic_array.sv"
#
#   make MODULE=test_top TOPLEVEL=tiny_tpu_top \
#        VERILOG_SOURCES="../rtl/pe.sv ../rtl/systolic_array.sv \
#                         ../rtl/controller.sv ../rtl/tiny_tpu_top.sv"

SIM           ?= verilator
TOPLEVEL_LANG ?= verilog

# Paths are relative to sim/ (where make is run).
VERILOG_SOURCES ?= $(abspath ../rtl/pe.sv)
TOPLEVEL        ?= pe
MODULE          ?= test_pe

# Waveform traces land in sim_build/dump.fst; open with gtkwave.
WAVES ?= 1

include $(shell cocotb-config --makefiles)/Makefile.sim
