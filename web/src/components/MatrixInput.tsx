/**
 * MatrixInput — editable A and B matrix grids for the TinyTPU visualizer.
 *
 * Features:
 *   - Square matrix size selector: 2..8 (hardware handles ≤4 natively; >4 tiles).
 *   - Cell inputs clamped to signed int8 range [−128, 127].
 *   - "Run" fires onRun(size, aFlat, bFlat) with flat row-major arrays.
 *   - Default values match the 3×3 demo from useTinyTpu DEFAULT_A/B_FLAT.
 *
 * Pure presentational below the onRun callback — no WASM calls here.
 */

import { useState, useCallback, type ChangeEvent } from "react";
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
    <div className="space-y-2">
      <span className="text-sm font-semibold text-muted-foreground">{label}</span>
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
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MatrixInput({ isRunning, onRun }: MatrixInputProps) {
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
    const s = DEFAULT_SIZE;
    setSize(s);
    setAMatrix(DEFAULT_A.map((row) => [...row]));
    setBMatrix(DEFAULT_B.map((row) => [...row]));
  }, []);

  const handleRun = useCallback(() => {
    const aFlat = flattenMatrix(aMatrix);
    const bFlat = flattenMatrix(bMatrix);
    onRun(size, aFlat, bFlat);
  }, [size, aMatrix, bMatrix, onRun]);

  const isNativePath = size <= 4;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      {/* Header row: title + size selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">Matrices</p>
          <p className="text-xs text-muted-foreground">
            {isNativePath
              ? "4×4 hardware — single RTL pass"
              : `${size}×${size} → tiles into ${Math.ceil(size / 4) ** 2 * Math.ceil(size / 4)} RTL passes`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Size</span>
          <div className="flex gap-1">
            {([2, 3, 4, 6, 8] as const).map((n) => (
              <button
                key={n}
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
        <div className="flex items-center self-center pt-5">
          <span className="text-lg text-muted-foreground select-none">×</span>
        </div>
        <MatrixGrid
          label="B"
          matrix={bMatrix}
          onChange={handleBChange}
          size={size}
        />
        <div className="flex items-center self-center pt-5">
          <span className="text-lg text-muted-foreground select-none">=</span>
        </div>
        <div className="space-y-2">
          <span className="text-sm font-semibold text-muted-foreground">C</span>
          <div
            className="inline-grid gap-1"
            style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: size }, (_, r) =>
              Array.from({ length: size }, (__, c) => (
                <div
                  key={`${r}-${c}`}
                  className="h-9 w-12 rounded border border-dashed border-border/50 bg-muted/30 flex items-center justify-center text-xs font-mono text-muted-foreground/50 select-none"
                >
                  ?
                </div>
              )),
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

// Silence unused import warning — makeMatrix is exported for tests
export { makeMatrix };
