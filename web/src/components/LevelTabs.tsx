/**
 * LevelTabs - progressive disclosure tabs for the TinyTPU visualizer.
 *
 * Three levels of detail, each with a plain-English explainer:
 *
 *   L1 "One Cell"  - zoom into a single PE; watch the MAC equation tick.
 *   L2 "The Array" - the full 4×4 grid animation (default view).
 *   L3 "Tiling"    - how matrices > 4×4 are split into real RTL tile-passes.
 *
 * Each explainer is brief (2–3 sentences), hardware-accurate, and jargon-light.
 * L3 is opt-in (a tab); L2 stays the default.
 */

import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Controls } from "@/components/Controls";
import { PEGrid } from "@/components/PEGrid";
import { L1SinglePE } from "@/components/L1SinglePE";
import { L3TilingView } from "@/components/L3TilingView";
import type { CycleState } from "@/lib/state-schema";
import type { SpeedOption } from "@/hooks/useTinyTpu";
import type { TiledPass } from "@/hooks/useTiledTpu";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LevelTabsProps {
  // L1 + L2: native 4×4 run data
  states: readonly CycleState[];
  cycleIdx: number;
  isPlaying: boolean;
  isLoaded: boolean;
  speed: SpeedOption;
  onPlay: () => void;
  onPause: () => void;
  onToggle: () => void;
  onStepForward: () => void;
  onStepBack: () => void;
  onReset: () => void;
  onScrub: (idx: number) => void;
  onSpeedChange: (s: SpeedOption) => void;

  // L3: tiled run data
  tiledPasses: readonly TiledPass[];
  tiledAssembledC: readonly number[] | null;
  tiledMatSize: number;
}

// ─── Explainer card ────────────────────────────────────────────────────────────

function Explainer({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
      {children}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LevelTabs({
  states,
  cycleIdx,
  isPlaying,
  isLoaded,
  speed,
  onPlay,
  onPause,
  onToggle,
  onStepForward,
  onStepBack,
  onReset,
  onScrub,
  onSpeedChange,
  tiledPasses,
  tiledAssembledC,
  tiledMatSize,
}: LevelTabsProps) {
  const currentState = states[cycleIdx];

  return (
    <Tabs defaultValue="l2" className="space-y-3">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="l1">L1 - One Cell</TabsTrigger>
        <TabsTrigger value="l2">L2 - The Array</TabsTrigger>
        <TabsTrigger value="l3">L3 - Tiling</TabsTrigger>
      </TabsList>

      {/* ── L1: One Cell ──────────────────────────────────────────────────── */}
      <TabsContent value="l1" className="space-y-4">
        <Explainer>
          Every Processing Element (PE) is a tiny arithmetic unit that does one
          thing: multiply a stored weight by an incoming activation and add it to a
          running sum. Select any PE in the 4×4 grid and watch its MAC equation
          fire cycle by cycle. This is the heartbeat of every TPU.
        </Explainer>

        <L1SinglePE states={states} cycleIdx={cycleIdx} />

        {/* Minimal cycle nav for L1 */}
        <Controls
          cycleIdx={cycleIdx}
          totalCycles={states.length}
          isPlaying={isPlaying}
          isLoaded={isLoaded}
          fsmState={currentState?.fsmState ?? null}
          speed={speed}
          onPlay={onPlay}
          onPause={onPause}
          onToggle={onToggle}
          onStepForward={onStepForward}
          onStepBack={onStepBack}
          onReset={onReset}
          onScrub={onScrub}
          onSpeedChange={onSpeedChange}
        />
      </TabsContent>

      {/* ── L2: The Array ─────────────────────────────────────────────────── */}
      <TabsContent value="l2" className="space-y-4">
        <Explainer>
          The full 4×4 systolic array executing a matrix multiply. Matrix B sits
          stationary inside the PEs as weights (blue). Matrix A streams in from the
          left, row-skewed so operands meet at the right PE at the right cycle
          (green = MAC firing). Results accumulate downward and exit the bottom
          (emerald).
        </Explainer>

        <Controls
          cycleIdx={cycleIdx}
          totalCycles={states.length}
          isPlaying={isPlaying}
          isLoaded={isLoaded}
          fsmState={currentState?.fsmState ?? null}
          speed={speed}
          onPlay={onPlay}
          onPause={onPause}
          onToggle={onToggle}
          onStepForward={onStepForward}
          onStepBack={onStepBack}
          onReset={onReset}
          onScrub={onScrub}
          onSpeedChange={onSpeedChange}
        />

        {currentState && <PEGrid state={currentState} />}
      </TabsContent>

      {/* ── L3: Tiling ────────────────────────────────────────────────────── */}
      <TabsContent value="l3" className="space-y-4">
        <Explainer>
          A 4×4 array can only hold 16 weights. For larger matrices, the multiply
          is split into 4×4 tiles processed in multiple passes - each pass runs
          entirely on the real RTL hardware. Partial results from passes that share
          the same output tile are summed in TypeScript (orchestration, not
          matmul). Try an 8×8 input: it becomes eight RTL passes and the assembled
          result still bit-matches numpy.
        </Explainer>

        <L3TilingView
          passes={tiledPasses}
          assembledC={tiledAssembledC}
          matSize={tiledMatSize}
        />
      </TabsContent>
    </Tabs>
  );
}
