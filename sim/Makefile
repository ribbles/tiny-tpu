# Flexible Multi-Target Verification Makefile

SIM           ?= icarus
TOPLEVEL_LANG ?= verilog

# Add your new source module list here
VERILOG_SOURCES = ../rtl/pe.sv \
                  ../rtl/controller.sv \
                  ../rtl/systolic_array.sv \
                  ../rtl/tiny_tpu_top.sv \
                  ../rtl/tpu_uart_receiver.sv \
                  ../rtl/tpu_command_decoder.sv \
                  ../rtl/tpu_uart_transmitter.sv \
                  ../rtl/tpu_core_hardware_wrapper.sv \
                  ../rtl/tpu_top_shell.sv

# MINICONDA ENVIRONMENT EXTENSION CLAMP SETTINGS
export PYTHONHOME = C:/Users/wolfpack/Miniconda3/envs/tpu-lesson
export PYTHONPATH = C:/Users/wolfpack/Miniconda3/envs/tpu-lesson/Lib/site-packages
COCOTB_MAKEFILES_DIR = C:/Users/wolfpack/Miniconda3/envs/tpu-lesson/Lib/site-packages/cocotb_tools/makefiles

# DEFAULT TARGET FLAGS (Can be overridden via command line variables)
TOPLEVEL ?= tpu_top_shell
MODULE   ?= test_decoder_core
WAVES    ?= 1

include $(COCOTB_MAKEFILES_DIR)/Makefile.sim
