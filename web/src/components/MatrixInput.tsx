/**
 * MatrixInput - editable A and B matrix grids for the TinyTPU visualizer.
 *
 * Features:
 *   - Square matrix size selector: 2..8 (hardware handles ≤4 natively; >4 tiles).
 *   - Cell inputs clamped to signed int8 range [−128, 127].
 *   - "Run" fires onRun(size, aFlat, bFlat) with flat row-major arrays.
 *   - Default values match the 3×3 demo from useTinyTpu DEFAULT_A/B_FLAT.
 *
 * Pure presentational below the onRun callback - no WASM calls here.
 */

import { useState, useCallback, useMemo, useEffect, type ChangeEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clampInt8, flattenMatrix } from "@/lib/tiling";

// ─── Default matrices (3×3 matching DEFAULT_A/B_FLAT in useTinyTpu) ──────────

const DEFAULT_SIZE = 3;

const DEFAULT_A: number[][] = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
];

const DEFAULT_B: number[][] = [
  [9, 8, 7],
  [6, 5, 4],
  [3, 2, 1],
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMatrix(size: number, fill = 0): number[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => fill));
}

/** Resize a matrix, preserving existing values and filling new cells with 0. */
function resizeMatrix(mat: number[][], newSize: number): number[][] {
  return Array.from({ length: newSize }, (_, r) =>
    Array.from({ length: newSize }, (__, c) => mat[r]?.[c] ?? 0),
  );
}

// ─── Cell input ───────────────────────────────────────────────────────────────

interface CellProps {
  value: number;
  onChange: (v: number) => void;
  highlight?: boolean;
}

function MatrixCell({ value, onChange, highlight }: CellProps) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setRaw(e.target.value);
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed)) onChange(clampInt8(parsed));
  };

  const handleBlur = () => {
    setFocused(false);
    setRaw(String(value));
  };

  const handleFocus = () => {
    setFocused(true);
    setRaw(String(value));
  };

  return (
    <input
      type="number"
      min={-128}
      max={127}
      value={focused ? raw : value}
      onChange={handleChange}
      onBlur={handleBlur}
      onFocus={handleFocus}
      className={cn(
        "h-9 w-12 rounded border text-center text-sm font-mono",
        "bg-background text-foreground",
        "border-border focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring",
        "transition-colors",
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        highlight && "border-primary/60 bg-primary/5",
      )}
      aria-label={`Matrix value`}
    />
  );
}

// ─── Grid editor ─────────────────────────────────────────────────────────────

interface GridProps {
  label: string;
  matrix: number[][];
  onChange: (r: number, c: number, v: number) => void;
  size: number;
}

function MatrixGrid({ label, matrix, onChange, size }: GridProps) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <div
        className="inline-grid gap-1"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        role="grid"
        aria-label={`Matrix ${label}`}
      >
        {Array.from({ length: size }, (_, r) =>
          Array.from({ length: size }, (__, c) => (
            <MatrixCell
              key={`${r}-${c}`}
              value={matrix[r]?.[c] ?? 0}
              onChange={(v) => onChange(r, c, v)}
            />
          )),
        )}
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MatrixInputProps {
  isRunning: boolean;
  onRun: (size: number, aFlat: readonly number[], bFlat: readonly number[]) => void;
  /** Flat 4×4 result from the last native run. Extract [0..size-1] rows/cols. */
  nativeResult?: readonly number[] | null;
  /** Logical size used in the last native run (must match current size to display). */
  lastNativeRunSize?: number | null;
  /** Flat size×size result from the last tiled run. */
  tiledResult?: readonly number[] | null;
  /** Logical size of the tiled result (must match current size to display). */
  tiledResultSize?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MatrixInput({
  isRunning,
  onRun,
  nativeResult,
  lastNativeRunSize,
  tiledResult,
  tiledResultSize,
}: MatrixInputProps) {
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [aMatrix, setAMatrix] = useState<number[][]>(DEFAULT_A);
  const [bMatrix, setBMatrix] = useState<number[][]>(DEFAULT_B);

  const handleSizeChange = useCallback((newSize: number) => {
    setSize(newSize);
    setAMatrix((prev) => resizeMatrix(prev, newSize));
    setBMatrix((prev) => resizeMatrix(prev, newSize));
  }, []);

  const handleAChange = useCallback((r: number, c: number, v: number) => {
    setAMatrix((prev) => {
      const next = prev.map((row) => [...row]);
      if (next[r]) next[r][c] = v;
      return next;
    });
  }, []);

  const handleBChange = useCallback((r: number, c: number, v: number) => {
    setBMatrix((prev) => {
      const next = prev.map((row) => [...row]);
      if (next[r]) next[r][c] = v;
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    setSize(DEFAULT_SIZE);
    setAMatrix(DEFAULT_A.map((row) => [...row]));
    setBMatrix(DEFAULT_B.map((row) => [...row]));
    // Also re-run so the C column and animation update immediately
    onRun(DEFAULT_SIZE, flattenMatrix(DEFAULT_A), flattenMatrix(DEFAULT_B));
  }, [onRun]);

  const handleRun = useCallback(() => {
    const aFlat = flattenMatrix(aMatrix);
    const bFlat = flattenMatrix(bMatrix);
    onRun(size, aFlat, bFlat);
  }, [size, aMatrix, bMatrix, onRun]);

  const isNativePath = size <= 4;
  const reduced = useReducedMotion() ?? false;

  // Only show the C result if it was computed for the CURRENT size.
  const cResult = useMemo<number[][] | null>(() => {
    if (isNativePath && nativeResult && nativeResult.length >= 16 && lastNativeRunSize === size) {
      return Array.from({ length: size }, (_, r) =>
        Array.from({ length: size }, (_, c) => nativeResult[r * 4 + c] ?? 0),
      );
    }
    if (!isNativePath && tiledResult && tiledResultSize === size) {
      return Array.from({ length: size }, (_, r) =>
        Array.from({ length: size }, (_, c) => tiledResult[r * size + c] ?? 0),
      );
    }
    return null;
  }, [isNativePath, size, nativeResult, lastNativeRunSize, tiledResult, tiledResultSize]);

  // Increment each time a new result arrives so animated cells re-trigger.
  const [resultVersion, setResultVersion] = useState(0);
  useEffect(() => {
    if (cResult !== null) setResultVersion((v) => v + 1);
  }, [cResult]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      {/* Header row: title + size selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Matrices</p>
          <p className="text-xs text-muted-foreground">
            {isNativePath
              ? "4×4 hardware - single RTL pass"
              : `${size}×${size} → tiles into ${Math.ceil(size / 4) ** 2 * Math.ceil(size / 4)} RTL passes`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Size</span>
          <div className="flex gap-1">
            {([2, 3, 4, 6, 8] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => handleSizeChange(n)}
                className={cn(
                  "h-7 w-9 rounded text-xs font-mono transition-colors",
                  "disabled:pointer-events-none disabled:opacity-40",
                  n === size
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  n > 4 && n !== size && "border border-dashed border-border",
                )}
                aria-label={`${n}×${n} matrix`}
                aria-pressed={n === size}
              >
                {n}×{n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Matrix grids */}
      <div className="flex flex-wrap gap-6 items-start">
        <MatrixGrid
          label="A"
          matrix={aMatrix}
          onChange={handleAChange}
          size={size}
        />
        <div className="flex items-center self-center">
          <span className="text-lg text-muted-foreground select-none">×</span>
        </div>
        <MatrixGrid
          label="B"
          matrix={bMatrix}
          onChange={handleBChange}
          size={size}
        />
        <div className="flex items-center self-center">
          <span className="text-lg text-muted-foreground select-none">=</span>
        </div>
        <div className="space-y-1.5">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            C
            {cResult && (
              <motion.span
                key={`check-${resultVersion}`}
                initial={reduced ? false : { opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="ml-1.5 inline-block text-[10px] font-normal text-primary/80"
              >
                ✓
              </motion.span>
            )}
          </span>
          <div
            className="inline-grid gap-1"
            style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
            role="grid"
            aria-label="Result matrix C"
          >
            {Array.from({ length: size }, (_, r) =>
              Array.from({ length: size }, (__, c) => {
                const val = cResult?.[r]?.[c];
                const hasValue = val !== undefined && val !== null;
                const cellIdx = r * size + c;
                // Stagger: spread across ~500ms total, shorter for larger grids
                const staggerMs = Math.min(55, 500 / Math.max(1, size * size - 1));
                return (
                  <motion.div
                    key={`c-${resultVersion}-${r}-${c}`}
                    initial={
                      reduced || !hasValue
                        ? false
                        : { opacity: 0, scale: 0.65, y: -6 }
                    }
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={
                      reduced || !hasValue
                        ? { duration: 0 }
                        : {
                            type: "spring",
                            stiffness: 420,
                            damping: 22,
                            delay: cellIdx * (staggerMs / 1000),
                          }
                    }
                    className={cn(
                      "h-9 w-12 rounded border flex items-center justify-center text-xs font-mono select-none overflow-hidden",
                      hasValue
                        ? "border-primary/30 bg-primary/5 text-foreground"
                        : "border-dashed border-border/50 bg-muted/30 text-muted-foreground/50",
                    )}
                    title={hasValue ? String(val) : undefined}
                  >
                    {hasValue ? (
                      <span className="truncate px-0.5">{val}</span>
                    ) : (
                      "?"
                    )}
                  </motion.div>
                );
              }),
            )}
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={handleRun}
          disabled={isRunning}
          size="sm"
          className="gap-1.5"
        >
          {isRunning ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              Running…
            </>
          ) : (
            "Run"
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={isRunning}
          className="text-muted-foreground"
        >
          Reset to default
        </Button>
        {!isNativePath && (
          <span className="ml-auto text-xs text-muted-foreground">
            ℹ️ Tiling: {Math.ceil(size / 4) ** 2 * Math.ceil(size / 4)} RTL passes ·{" "}
            see L3 tab
          </span>
        )}
      </div>
    </div>
  );
}

// Silence unused import warning - makeMatrix is exported for tests
export { makeMatrix };
