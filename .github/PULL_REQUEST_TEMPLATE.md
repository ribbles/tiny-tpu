# Pull Request

## Summary

<!-- 1–3 bullet points. What changed and why. Focus on intent, not the diff. Be specific. -->

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
- [ ] `perf` — performance improvement
- [ ] `ci` — GitHub Actions change
- [ ] `spike` — throwaway proof-of-concept (merging findings, not shipping code)

## What Was Changed and Why

<!-- More detail than the summary. Explain the "why" behind key decisions, not just what the diff shows. -->

### Key decisions

<!-- List any non-obvious choices made: architectural trade-offs, alternatives rejected, known limitations -->

-

## RTL Changes

<!-- Skip if no RTL was modified -->

- [ ] `verilator --lint-only -Wall rtl/*.sv` — clean (zero warnings)
- [ ] No `UNOPTFLAT` / `BLKANDNBLK` / inferred-latch warnings
- [ ] RTL output bit-matches `sim/golden.py` (numpy): `pytest sim/golden.py -q`
- [ ] cocotb test suites pass for all changed modules
- [ ] No `#delays`, no `initial` blocks in design modules, no `$display`
- [ ] RTL remains synthesizable (always_ff / always_comb only)

## WASM Changes

<!-- Skip if WASM was not rebuilt -->

- [ ] `bash wasm/build.sh` succeeds, produces `web/public/tiny_tpu.mjs` + `.wasm`
- [ ] Visualizer still loads and runs in browser after rebuild
- [ ] Node cross-check: WASM matmul output matches `golden.py` for a sample input
- [ ] `docs/STATE_SCHEMA.md` and `web/src/lib/state-schema.ts` still in sync

## Frontend Changes

<!-- Skip if no web/ changes -->

- [ ] `pnpm lint` — clean
- [ ] `pnpm typecheck` — clean (`astro check && tsc --noEmit`)
- [ ] `pnpm build` — clean, no SSR/WASM import errors, all pages generated
- [ ] TypeScript strict — no `any`, `noUncheckedIndexedAccess` satisfied
- [ ] WASM never imported at module top level — only inside `useEffect` / `client:only="react"`
- [ ] No hydration mismatch in browser console
- [ ] Mobile layout tested (≥ 375px viewport)

## Docs / SEO Changes

<!-- Skip if no docs or SEO changes -->

- [ ] `docs/STATE_SCHEMA.md` updated if CycleState schema changed
- [ ] `web/src/lib/state-schema.ts` updated to match
- [ ] `rtl/README.md` updated if signal dictionary or dataflow changed
- [ ] OG image, JSON-LD, and canonical URL correct for new pages
- [ ] Sitemap includes new pages (check `/sitemap-index.xml` after build)

## Testing

<!-- Describe exactly how you verified the change works. Commands run + observed output. -->

```bash
# Example:
verilator --lint-only -Wall rtl/*.sv
pytest sim/golden.py -q
cd web && pnpm build
```

## Screenshots / Browser Output

<!-- For visualizer or UI changes: paste browser console output or a screenshot/recording.
     For WASM changes: confirm no abort() or undefined symbol errors. -->

## Branching Checklist

- [ ] This branch was created from `dev` (never from `main`)
- [ ] Target branch of this PR is `dev` (never `main`)
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `build:`, `docs:`, `ci:`, `chore:`, `refactor:`, `perf:`, `test:`)
- [ ] No large binaries committed except the intentional `web/public/tiny_tpu.wasm` artifact
- [ ] No secrets, env files, or credentials committed

## Reviewer Notes

<!-- Anything non-obvious: known limitations, follow-up issues, specific areas to focus on, things deliberately left out of scope -->

---

> **Source of truth reminder:** RTL is always the ground truth. The frontend reads state from WASM-compiled RTL — it never reimplements the matmul in JavaScript. Any PR that introduces a JS-side matmul reimplementation is automatically wrong.
