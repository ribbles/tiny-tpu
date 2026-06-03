"""
Shared pytest/cocotb configuration for TinyTPU simulation tests.

Sets a fixed random seed before any test runs so every test module that
draws random values produces identical sequences across CI and local runs.
"""

import random

import numpy as np

SEED = 42


def pytest_configure(config) -> None:
    """Seed both Python stdlib random and numpy before collection begins."""
    random.seed(SEED)
    np.random.seed(SEED)


def rand_int8(rng: random.Random | None = None) -> int:
    """Return a random signed 8-bit integer in [-128, 127]."""
    r = rng if rng is not None else random
    return r.randint(-128, 127)
