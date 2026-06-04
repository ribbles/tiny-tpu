/**
 * WasmSmokeTest - client-only React island.
 *
 * Loads the TinyTPU WASM module, runs a fixed 3×3 matmul (zero-padded to 4×4),
 * and verifies the result against the golden expected values computed from
 * sim/golden.py (numpy reference).
 *
 * Usage: <WasmSmokeTest client:only="react" />
 * Never render this component during SSR.
 */

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Fixed test case - 3×3 matmul zero-padded to the 4×4 hardware size
//
// A = [[1,2,3],[4,5,6],[7,8,9]]   padded row-major → flat[16]
// B = [[9,8,7],[6,5,4],[3,2,1]]   padded row-major → flat[16]
//
// Expected C (hand-verified against sim/golden.py):
//   C[0] = [30, 24, 18, 0]   (1*9+2*6+3*3, 1*8+2*5+3*2, 1*7+2*4+3*1)
//   C[1] = [84, 69, 54, 0]   (4*9+5*6+6*3, ...)
//   C[2] = [138,114, 90, 0]  (7*9+8*6+9*3, ...)
//   C[3] = [0,  0,   0,  0]  (zero row × anything)
// ---------------------------------------------------------------------------

const A_FLAT = [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 0, 0, 0, 0] as const;
const B_FLAT = [9, 8, 7, 0, 6, 5, 4, 0, 3, 2, 1, 0, 0, 0, 0, 0] as const;
const EXPECTED = [30, 24, 18, 0, 84, 69, 54, 0, 138, 114, 90, 0, 0, 0, 0, 0] as const;

type Status = "loading" | "pass" | "fail" | "error";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MatrixGrid({
  label,
  flat,
  highlight,
}: {
  label: string;
  flat: readonly number[];
  highlight?: readonly number[];
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">{label}</p>
      <div className="inline-grid grid-cols-4 gap-1">
        {flat.map((v, idx) => {
          const mismatch = highlight !== undefined && highlight[idx] !== v;
          return (
            <span
              key={idx}
              className={[
                "w-12 h-8 flex items-center justify-center rounded text-xs font-mono border",
                mismatch
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-border bg-card text-card-foreground",
              ].join(" ")}
            >
              {v}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    loading: "border-muted-foreground text-muted-foreground animate-pulse",
    pass: "border-pe-active text-pe-active",
    fail: "border-destructive text-destructive",
    error: "border-destructive text-destructive",
  };
  const labels: Record<Status, string> = {
    loading: "Loading WASM…",
    pass: "✓ PASS - result matches expected",
    fail: "✗ FAIL - result mismatch",
    error: "✗ ERROR",
  };
  return (
    <span
      className={`inline-flex items-center gap-2 rounded border px-3 py-1 text-sm font-mono ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WasmSmokeTest() {
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState<readonly number[] | null>(null);
  const [cycles, setCycles] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function runSmoke() {
      try {
        // Dynamic import of the loader - keeps this import out of SSR paths.
        // The loader itself never runs during SSR; belt-and-suspenders safety.
        const { loadTinyTpu } = await import("../lib/wasm-loader");
        const tpu = await loadTinyTpu();

        try {
          tpu.reset();
          tpu.loadA(A_FLAT);
          tpu.loadB(B_FLAT);
          tpu.start();
          tpu.run();
          const res = tpu.getResult();
          const count = tpu.getCycleCount();

          if (!mounted) return;

          setResult(res);
          setCycles(count);

          const allMatch = EXPECTED.every((expected, i) => res[i] === expected);
          setStatus(allMatch ? "pass" : "fail");
        } finally {
          tpu.destroy();
        }
      } catch (e) {
        if (!mounted) return;
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    }

    void runSmoke();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-6 rounded-lg border border-border bg-card p-6 text-card-foreground">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          WASM Smoke Test
        </h2>
        <p className="text-xs text-muted-foreground">
          3×3 matmul zero-padded to 4×4 · runs on real compiled RTL
        </p>
      </div>

      <StatusBadge status={status} />

      {status === "error" && errorMsg && (
        <pre className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {errorMsg}
        </pre>
      )}

      {cycles !== null && (
        <p className="text-xs text-muted-foreground font-mono">
          Completed in <span className="text-foreground">{cycles}</span> clock cycles
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 items-start">
        <MatrixGrid label="A (input)" flat={A_FLAT} />
        <div className="flex items-center justify-center pt-6">
          <span className="text-2xl text-muted-foreground">×</span>
        </div>
        <MatrixGrid label="B (weights)" flat={B_FLAT} />
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 items-start border-t border-border pt-6">
        {result !== null && (
          <MatrixGrid label="Result (from WASM)" flat={result} highlight={[...EXPECTED]} />
        )}
        <MatrixGrid label="Expected (golden)" flat={EXPECTED} />
      </div>
    </div>
  );
}
