/**
 * Exp 3 · Invalidación por escritura (R8, R22): demuestra AMBAS estrategias y
 * el contraste con la ventana de staleness del TTL puro.
 *
 *   Fase A (TTL puro): populate v1 → escritura directa a la fuente (sin tocar
 *     el caché) → la lectura siguiente devuelve v1 STALE (hit, 0 queries).
 *   Fase B (invalidate): populate v1 → updateStockQuantity(..., "invalidate")
 *     → la lectura siguiente es miss y recarga: v2 al instante (1 query).
 *   Fase C (update): populate v1 → updateStockQuantity(..., "update") → la
 *     lectura siguiente es HIT con v2 ya en caché (0 queries).
 */
import { closePool, getQueryCount, pool, queryWithTiming } from "./db.ts";
import { createPgStockRepository } from "./source.ts";
import type { StockSummary } from "./source.ts";
import { createInMemoryCache } from "./cache.ts";
import { getStockSummary, updateStockQuantity } from "./api.ts";
import { realNow } from "./clock.ts";
import { printBanner, printSummary, printTable } from "./reporter.ts";

const SKU = "SKU-0000001"; // determinista: primera fila del seed (R19)

function delta(before: number): number {
  return getQueryCount() - before;
}

async function main(): Promise<void> {
  printBanner("LAB-05 · Exp 3 · Invalidación por escritura (invalidate vs update)");

  await queryWithTiming("SELECT 1");
  const repo = createPgStockRepository(pool);
  const ttlMs = 60_000;

  // ── Fase A: TTL puro — ventana de staleness (R7, R22 contrast) ────────────
  await repo.updateQuantity(SKU, 1); // baseline: la fila SKU vale 1
  const cacheA = createInMemoryCache<StockSummary>(realNow);
  const sumBeforeA = (await getStockSummary(repo, cacheA, { ttlMs })).totalQuantity; // populate v1 (miss)
  let q = getQueryCount();
  await repo.updateQuantity(SKU, 1000); // escritura directa, sin tocar el caché
  const writeA = delta(q);
  q = getQueryCount();
  const readA = await getStockSummary(repo, cacheA, { ttlMs }); // HIT → stale
  const readAQueries = delta(q);
  const freshA = readA.totalQuantity === sumBeforeA + 999; // la caché NO vio el +999

  // ── Fase B: invalidate — la próxima lectura recarga (R17, R22) ────────────
  await repo.updateQuantity(SKU, 1);
  const cacheB = createInMemoryCache<StockSummary>(realNow);
  const sumBeforeB = (await getStockSummary(repo, cacheB, { ttlMs })).totalQuantity; // populate v1 (miss)
  q = getQueryCount();
  await updateStockQuantity(repo, SKU, 2000, cacheB, "invalidate");
  const writeB = delta(q);
  q = getQueryCount();
  const readB = await getStockSummary(repo, cacheB, { ttlMs }); // miss tras invalidate → recarga
  const readBQueries = delta(q);
  const freshB = readB.totalQuantity === sumBeforeB + 1999; // la recarga vio el +1999

  // ── Fase C: update — la lectura siguiente es HIT con v2 (R8) ──────────────
  await repo.updateQuantity(SKU, 1);
  const cacheC = createInMemoryCache<StockSummary>(realNow);
  const sumBeforeC = (await getStockSummary(repo, cacheC, { ttlMs })).totalQuantity; // populate v1 (miss)
  q = getQueryCount();
  await updateStockQuantity(repo, SKU, 3000, cacheC, "update"); // write + recompute
  const writeC = delta(q);
  q = getQueryCount();
  const readC = await getStockSummary(repo, cacheC, { ttlMs }); // HIT → v2 en caché
  const readCQueries = delta(q);
  const freshC = readC.totalQuantity === sumBeforeC + 2999; // el recompute vio el +2999

  printTable(
    ["estrategia", "próxima lectura", "llamadas fuente (write)", "llamadas fuente (read)", "¿fresco?"],
    [
      ["TTL puro (sin invalidación)", "HIT (stale v1)", String(writeA), String(readAQueries), freshA ? "sí" : "NO"],
      ["invalidate", "MISS (reload v2)", String(writeB), String(readBQueries), freshB ? "sí" : "NO"],
      ["update", "HIT (v2 en caché)", String(writeC), String(readCQueries), freshC ? "sí" : "NO"],
    ],
  );

  printSummary({
    title: "Exp 3 · Invalidación por escritura",
    stats: [
      ["fase A (TTL puro)", `v1 stale (${readA.totalQuantity}) — fresco: ${freshA ? "sí" : "no"}`],
      ["fase B (invalidate)", `v2 al instante (${readB.totalQuantity}) — fresco: ${freshB ? "sí" : "no"}`],
      ["fase C (update)", `v2 al instante (${readC.totalQuantity}) — fresco: ${freshC ? "sí" : "no"}`],
    ],
    anomalies: [
      { text: "A: stale (v1) sin invalidación", cls: freshA ? "bad" : "ok" },
      { text: "B: v2 inmediato tras invalidate", cls: freshB ? "ok" : "bad" },
      { text: "C: v2 inmediato tras update (HIT)", cls: freshC ? "ok" : "bad" },
    ],
    verdict: freshB && freshC && !freshA
      ? "Invalidación OK: escribir + leer devuelve el dato nuevo sin esperar el TTL"
      : "Comportamiento inesperado",
    verdictCls: freshB && freshC && !freshA ? "ok" : "bad",
  });

  await closePool();
}

main().catch(async (error: unknown) => {
  console.error("\n❌ Exp 3 falló:", error);
  await closePool();
  process.exit(1);
});