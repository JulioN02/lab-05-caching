/**
 * Exp 2 · Cache-aside con TTL (R21, R13): N lecturas a través del caché.
 *
 * El primer get es miss (1 query); el resto son hits (0 queries). Reporta
 * latencia avg/p95/p99, hit ratio (de `cache.stats()`), requestsToDb y memoria
 * del valor cacheado. Criterio RELATIVO (no hardcodeado): hitRatio >= 0.99 —
 * si un run se acerca al TTL, se ajusta LAB_TTL_MS/LAB_ROWS.
 */
import { closePool, getQueryCount, pool, queryWithTiming, resetQueryCount } from "./db.ts";
import { createPgStockRepository } from "./source.ts";
import type { StockSummary } from "./source.ts";
import { createInMemoryCache } from "./cache.ts";
import { getStockSummary } from "./api.ts";
import { realNow } from "./clock.ts";
import { measureReads, serializedBytes } from "./evidence.ts";
import { printBanner, printSummary } from "./reporter.ts";

async function main(): Promise<void> {
  const n = Number(process.env.LAB_REQUESTS ?? 1000);
  const ttlMs = Number(process.env.LAB_TTL_MS ?? 30_000);
  printBanner("LAB-05 · Exp 2 · Cache-aside con TTL");

  await queryWithTiming("SELECT 1");
  const repo = createPgStockRepository(pool);
  const cache = createInMemoryCache<StockSummary>(realNow);
  const run = async (): Promise<void> => {
    await getStockSummary(repo, cache, { ttlMs });
  };

  // Warm-up directo a la fuente (R13, descartada): el miss inicial de caché
  // queda DENTRO del loop medido para que requestsToDb === 1.
  await repo.fetchStockSummary();
  resetQueryCount();

  const report = await measureReads(run, n, 0);
  const requestsToDb = getQueryCount();
  const stats = await cache.stats();
  const hitRatio = stats.hitRatio;

  // Criterio relativo: el hit ratio depende de TTL vs duración del run.
  const ok = hitRatio >= 0.99 && requestsToDb === 1;
  const cached = await getStockSummary(repo, cache, { ttlMs }); // hit (0 queries)
  const bytes = serializedBytes(cached);

  printSummary({
    title: "Exp 2 · Cache-aside con TTL",
    stats: [
      ["n", String(report.n)],
      ["avg ms", String(report.avgMs)],
      ["p95 ms", String(report.p95Ms)],
      ["p99 ms", String(report.p99Ms)],
      ["hitRatio", hitRatio.toFixed(4)],
      ["requestsToDb", String(requestsToDb)],
      ["cache size", String(stats.size)],
      ["bytes", String(bytes)],
    ],
    anomalies: [
      { text: `hitRatio >= 0.99 (${hitRatio.toFixed(4)})`, cls: hitRatio >= 0.99 ? "ok" : "warn" },
      { text: `requestsToDb === 1 (${requestsToDb})`, cls: requestsToDb === 1 ? "ok" : "bad" },
    ],
    verdict: ok ? "Cache TTL OK: 1 sola query para N lecturas" : "Revisar TTL/N (criterio relativo)",
    verdictCls: ok ? "ok" : "warn",
  });

  await closePool();
}

main().catch(async (error: unknown) => {
  console.error("\n❌ Exp 2 falló:", error);
  await closePool();
  process.exit(1);
});