# FPGA TPU

## Prerequisites

```
conda create -n tpu-lesson python=3.10
pip install -r requirements.txt
```

## Train Dataset

```
python train_mnist.py
```

## Tests

### Testing 


## FPGA Synth Place & Pick:

See [gowin\npu-lession\npu-lession.gprj](gowin\npu-lession\npu-lession.gprj).

## Flash FPGA

```
openFPGALoader.exe -b tangnano9k -f gowin/impl/pnr/npu-lession.fs
```