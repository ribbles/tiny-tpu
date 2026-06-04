/**
 * Visualizer — the main client-only island for TinyTPU.
 *
 * Owns:
 *   - MatrixInput: lets the user edit matrices A and B (2×2..8×8).
 *   - useTinyTpu: drives the 4×4 native WASM run (L1 + L2 views).
 *   - useTiledTpu: drives tiled runs for matrices > 4×4 (L3 view).
 *   - LevelTabs: routes between L1/L2/L3 progressive disclosure views.
 *
 * Run routing:
 *   - size ≤ 4: zero-pads to 4×4, calls tpu.runWith() → L1 + L2 show the result.
 *   - size > 4: calls tiledTpu.runTiled() → L3 shows the tiling; L1/L2 keep the
 *               last native run so they remain browsable.
 *
 * RULE: This component must be mounted as <Visualizer client:only="react" />.
 *       loadTinyTpu() (and framer-motion) must never run during SSR/build.
 */

import { useCallback } from "react";
import { LevelTabs } from "@/components/LevelTabs";
import { MatrixInput } from "@/components/MatrixInput";
import { useTinyTpu } from "@/hooks/useTinyTpu";
import { useTiledTpu } from "@/hooks/useTiledTpu";

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading TinyTPU simulator">
      <div className="h-36 rounded-lg border border-border bg-card" />
      <div className="h-10 rounded-lg border border-border bg-card" />
      <div className="mx-auto aspect-square w-full max-w-[464px] rounded-lg border border-border bg-card" />
    </div>
  );
}

// ─── Error card ───────────────────────────────────────────────────────────────

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center space-y-2">
      <p className="text-sm font-semibold text-destructive">Failed to load WASM</p>
      <pre className="text-xs text-destructive/80 whitespace-pre-wrap break-all">{message}</pre>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Zero-pad a flat row-major array from size×size to 4×4. */
function padTo4x4Flat(flat: readonly number[], size: number): readonly number[] {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < Math.min(size, 4); r++) {
    for (let c = 0; c < Math.min(size, 4); c++) {
      out[r * 4 + c] = flat[r * size + c] ?? 0;
    }
  }
  return out;
}

// ─── Visualizer ───────────────────────────────────────────────────────────────

export default function Visualizer() {
  const tpu = useTinyTpu();
  const tiledTpu = useTiledTpu();

  const handleRun = useCallback(
    (size: number, aFlat: readonly number[], bFlat: readonly number[]) => {
      if (size <= 4) {
        const a4 = padTo4x4Flat(aFlat, size);
        const b4 = padTo4x4Flat(bFlat, size);
        void tpu.runWith(a4, b4);
      } else {
        void tiledTpu.runTiled(size, aFlat, bFlat);
      }
    },
    [tpu, tiledTpu],
  );

  // Show error from whichever run failed (native or tiled)
  const error = tpu.error ?? tiledTpu.error;
  if (error) return <ErrorCard message={error} />;

  // Show skeleton only while the initial native load is happening
  if (!tpu.isLoaded && !tpu.error) return <LoadingSkeleton />;

  const isRunning = tiledTpu.isRunning;

  return (
    <div className="space-y-4">
      <MatrixInput
        isRunning={isRunning}
        onRun={handleRun}
      />

      <LevelTabs
        // L1 + L2 data (native run)
        states={tpu.states}
        cycleIdx={tpu.cycleIdx}
        isPlaying={tpu.isPlaying}
        isLoaded={tpu.isLoaded}
        speed={tpu.speed}
        onPlay={tpu.play}
        onPause={tpu.pause}
        onToggle={tpu.toggle}
        onStepForward={tpu.stepForward}
        onStepBack={tpu.stepBack}
        onReset={tpu.reset}
        onScrub={tpu.scrubTo}
        onSpeedChange={tpu.setSpeed}
        // L3 data (tiled run)
        tiledPasses={tiledTpu.passes}
        tiledAssembledC={tiledTpu.assembledC}
        tiledMatSize={tiledTpu.matSize}
      />
    </div>
  );
}
