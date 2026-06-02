## Summary

<!-- 1–3 bullet points. What changed and why. Focus on intent, not the diff. -->

-
-

## Type of Change

<!-- Check all that apply -->

- [ ] `feat` — new feature or capability
- [ ] `fix` — bug fix
- [ ] `build` — build system / toolchain change (WASM, Verilator, Emscripten)
- [ ] `refactor` — restructure without behavior change
- [ ] `test` — new or updated tests
- [ ] `docs` — documentation only
- [ ] `chore` — repo maintenance, CI, tooling
- [ ] `spike` — throwaway proof-of-concept (merging findings, not shipping code)

## RTL Changes

<!-- Skip if no RTL was modified -->

- [ ] `verilator --lint-only -Wall rtl/*.sv` — clean (zero warnings)
- [ ] No `UNOPTFLAT` / `BLKANDNBLK` / inferred-latch warnings
- [ ] RTL bit-matches `sim/golden.py` (numpy) — run `pytest sim/golden.py -q`
- [ ] cocotb test suites pass for changed modules

## WASM Changes

<!-- Skip if WASM was not rebuilt -->

- [ ] `bash wasm/build.sh` succeeds and produces `web/public/tiny_tpu.mjs` + `.wasm`
- [ ] Visualizer still loads in browser after rebuild
- [ ] `VL_IGNORE_UNKNOWN_ARCH` flag present for Emscripten builds (Verilator 5.x WASM quirk)
- [ ] `verilated_threads.cpp` included in `em++` invocation (resolves `VlThreadPool` linker symbol)

## Frontend Changes

<!-- Skip if no web/ changes -->

- [ ] `pnpm lint` — clean
- [ ] `pnpm typecheck` — clean
- [ ] `pnpm build` — clean, no SSR/WASM import errors
- [ ] TypeScript strict — no `any`, `noUncheckedIndexedAccess` satisfied
- [ ] WASM never imported at module top level; only inside `useEffect` / `client:only="react"`

## Testing

<!-- Describe how you verified the change works -->

```
# Commands run and their output
```

## Screenshots / Console Output

<!-- For WASM / visualizer changes, paste browser console output or screenshot -->

## Branching Checklist

- [ ] This branch was created from `dev` (not from `main`)
- [ ] Target branch is `dev` (not `main`)
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `build:`, etc.)
- [ ] No large binaries committed except intentional `web/public/tiny_tpu.wasm`

## Notes for Reviewer

<!-- Anything non-obvious: known limitations, follow-up tickets, trade-offs made -->
