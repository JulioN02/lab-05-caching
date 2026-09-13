/**
 * Helpers de medición y evidencia (R12–R15, R21, R23).
 *
 * Latencias en ms con `performance.now()` alrededor de la operación completa.
 * `measureReads` descarta el warm-up (R13): las muestras reportadas son
 * exactamente N. Los percentiles usan el precedente de lab-04 (`!` sobre el
 * índice clampado — patrón noUncheckedIndexedAccess).
 */

/** Redondea a 2 decimales (latencia honesta sub-ms). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Percentil (0..100) sobre un array ordenado ascendentemente. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  const clamped = Math.max(0, Math.min(sorted.length - 1, idx));
  return sorted[clamped]!;
}

export type LatencyReport = {
  n: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
};

/**
 * Ejecuta `warmup` iteraciones DESCARTADAS (R13) y luego N muestras medidas.
 * Devuelve avg/p95/p99 en ms. `run(i)` es la operación bajo prueba.
 */
export async function measureReads(
  run: (i: number) => Promise<void>,
  n: number,
  warmup = 1,
): Promise<LatencyReport> {
  for (let i = 0; i < warmup; i++) {
    await run(i);
  }
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await run(i);
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((acc, s) => acc + s, 0);
  return {
    n,
    avgMs: round2(sum / n),
    p95Ms: round2(percentile(sorted, 95)),
    p99Ms: round2(percentile(sorted, 99)),
  };
}

/** Bytes serializados de un valor (JSON) — reporte de memoria del valor cacheado. */
export function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}