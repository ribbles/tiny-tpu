/**
 * Controls - pure presentational transport bar for the TinyTPU visualizer.
 *
 * Renders:
 *   - FSM state badge (color-coded by phase)
 *   - Cycle counter  "N / M"
 *   - Scrubber       Slider across all cycles
 *   - Transport      [Reset] [◀ Step] [▶/⏸] [Step ▶]
 *   - Speed selector [0.5×] [1×] [2×] [4×]
 *
 * Pure props + callbacks - no WASM, no state ownership.
 */

import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { FsmState } from "@/lib/state-schema";
import { SPEED_OPTIONS, type SpeedOption } from "@/hooks/useTinyTpu";

// ─── FSM badge colors ─────────────────────────────────────────────────────────

const FSM_STYLES: Record<FsmState, string> = {
  IDLE:         "border-border text-muted-foreground",
  LOAD_WEIGHTS: "border-[oklch(0.627_0.194_247.6)] text-[oklch(0.627_0.194_247.6)]",
  STREAM:       "border-primary text-primary",
  DRAIN:        "border-[oklch(0.738_0.18_158.8)] text-[oklch(0.738_0.18_158.8)]",
  DONE:         "border-[oklch(0.738_0.18_158.8)] text-[oklch(0.738_0.18_158.8)]",
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ControlsProps {
  cycleIdx: number;
  /** Total number of cycles (0 while loading). */
  totalCycles: number;
  isPlaying: boolean;
  isLoaded: boolean;
  fsmState: FsmState | null;
  speed: SpeedOption;
  onPlay: () => void;
  onPause: () => void;
  onToggle: () => void;
  onStepForward: () => void;
  onStepBack: () => void;
  onReset: () => void;
  onScrub: (idx: number) => void;
  onSpeedChange: (speed: SpeedOption) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Controls({
  cycleIdx,
  totalCycles,
  isPlaying,
  isLoaded,
  fsmState,
  speed,
  onToggle,
  onStepForward,
  onStepBack,
  onReset,
  onScrub,
  onSpeedChange,
}: ControlsProps) {
  const disabled = !isLoaded;
  const maxIdx = Math.max(0, totalCycles - 1);
  const displayCycle = isLoaded ? cycleIdx + 1 : 0;
  const displayTotal = isLoaded ? totalCycles : 0;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      {/* ── Row 1: FSM badge + cycle counter ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {fsmState ? (
            <span
              className={cn(
                "inline-block min-w-[10rem] rounded border px-2 py-0.5 text-center text-xs font-mono",
                FSM_STYLES[fsmState],
              )}
            >
              {fsmState}
            </span>
          ) : (
            <span className="inline-block min-w-[10rem] rounded border border-border px-2 py-0.5 text-center text-xs font-mono text-muted-foreground">
              {isLoaded ? "-" : "Loading…"}
            </span>
          )}
          <span className="tabular-nums text-xs font-mono text-muted-foreground">
            Cycle{" "}
            <span className="text-foreground">{displayCycle}</span>
            {" / "}
            {displayTotal}
          </span>
        </div>

        {/* ── Speed selector ── */}
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">Speed</span>
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              disabled={disabled}
              className={cn(
                "h-6 rounded px-1.5 text-xs font-mono transition-colors",
                "disabled:pointer-events-none disabled:opacity-40",
                s === speed
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              aria-label={`Set speed to ${s}×`}
              aria-pressed={s === speed}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* ── Row 2: Scrubber ── */}
      <Slider
        min={0}
        max={maxIdx}
        step={1}
        value={[cycleIdx]}
        onValueChange={([val]) => {
          if (val !== undefined) onScrub(val);
        }}
        disabled={disabled}
        aria-label="Cycle scrubber"
        className={disabled ? "opacity-40" : ""}
      />

      {/* ── Row 3: Transport buttons ── */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onReset}
          disabled={disabled}
          aria-label="Reset to cycle 0"
          title="Reset"
          className="h-8 w-8"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={onStepBack}
          disabled={disabled || cycleIdx === 0}
          aria-label="Step back one cycle"
          title="Step back"
          className="h-8 w-8"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Button
          variant={isPlaying ? "outline" : "default"}
          size="icon"
          onClick={onToggle}
          disabled={disabled}
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause" : "Play"}
          className="h-9 w-9"
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={onStepForward}
          disabled={disabled || cycleIdx >= maxIdx}
          aria-label="Step forward one cycle"
          title="Step forward"
          className="h-8 w-8"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* Progress indicator - fixed-width dots, color-only transitions */}
        {isLoaded && totalCycles > 0 && (
          <div
            className="ml-auto flex items-center gap-0.5"
            aria-label={`Progress: ${cycleIdx + 1} of ${totalCycles} cycles`}
          >
            {Array.from({ length: totalCycles }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "inline-block h-1 w-1.5 rounded-full transition-colors duration-100",
                  i === cycleIdx
                    ? "bg-primary"
                    : i < cycleIdx
                      ? "bg-primary/40"
                      : "bg-muted",
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
