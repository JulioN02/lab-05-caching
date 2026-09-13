/**
 * Exp 4 · Medición consolidada (R23): tabla comparativa de las tres variantes.
 *
 *   baseline          N=300, lecturas directas a DB (1 query por request).
 *   cache-ttl         N=1000, TTL 30 s, solo lecturas (1 query total).
 *   cache-invalidate  N=1000, TTL 30 s + 1 escritura "invalidate" cada 100
 *                     lecturas → 9 reloads ⇒ hit ratio ≈ 99 % (distinto del
 *                     cache-ttl) y requests-to-DB mediblemente mayor.
 */
import { closePool, getQueryCount, pool, queryWithTiming, resetQueryCount } from "./db.ts";
import { createPgStockRepository } from "./source.ts";
import type { StockRepository, StockSummary } from "./source.ts";
import { createInMemoryCache } from "./cache.ts";
import type { Cache } from "./cache.ts";
import { getStockSummary, updateStockQuantity } from "./api.ts";
import { realNow } from "./clock.ts";
import { measureReads, serializedBytes } from "./evidence.ts";
import { printBanner, printSummary, printTable } from "./reporter.ts";

const SKU = "SKU-0000001";
const TTL_MS = 30_000;

type Variant = "baseline" | "cache-ttl" | "cache-invalidate";

type Row = {
  cells: readonly string[];
  hitRatio: number;
  requestsToDb: number;
};

async function runVariant(
  label: string,
  n: number,
  variant: Variant,
  repo: StockRepository,
): Promise<Row> {
  if (variant === "baseline") {
    await repo.fetchStockSummary(); // warm-up (R13)
    resetQueryCount();
    const report = await measureReads(
      async (): Promise<void> => {
        await repo.fetchStockSummary();
      },
      n,
      0,
    );
    const requestsToDb = getQueryCount();
    return {
      cells: [label, String(n), String(report.avgMs), String(report.p95Ms), "—", String(requestsToDb), "—"],
      hitRatio: 0,
      requestsToDb,
    };
  }

  const cache: Cache<StockSummary> = createInMemoryCache<StockSummary>(realNow);
  const run = async (i: number): Promise<void> => {
    if (variant === "cache-invalidate" && i > 0 && i % 100 === 0) {
      // 1 escritura invalidate cada 100 lecturas → la siguiente lectura recarga.
      await updateStockQuantity(repo, SKU, i, cache, "invalidate");
      return;
    }
    await getStockSummary(repo, cache, { ttlMs: TTL_MS });
  };

  // Warm-up directo a la fuente (R13, descartada): el miss inicial de caché
  // queda DENTRO del loop medido (cache-invalidate: 1 miss + 9 reloads).
  await repo.fetchStockSummary();
  resetQueryCount();
  const report = await measureReads(run, n, 0);
  const requestsToDb = getQueryCount();
  const stats = await cache.stats();
  const hitRatio = stats.hitRatio;
  const bytes = variant === "cache-ttl" ? serializedBytes(await getStockSummary(repo, cache, { ttlMs: TTL_MS })) : 0;

  return {
    cells: [
      label,
      String(n),
      String(report.avgMs),
      String(report.p95Ms),
      (hitRatio * 100).toFixed(2) + "%",
      String(requestsToDb),
      bytes === 0 ? "—" : String(bytes),
    ],
    hitRatio,
    requestsToDb,
  };
}

async function main(): Promise<void> {
  printBanner("LAB-05 · Exp 4 · Medición consolidada (3 variantes)");

  await queryWithTiming("SELECT 1");
  const repo = createPgStockRepository(pool);

  const baseline = await runVariant("baseline", 300, "baseline", repo);
  const cacheTtl = await runVariant("cache-ttl", 1000, "cache-ttl", repo);
  const cacheInvalidate = await runVariant("cache-invalidate", 1000, "cache-invalidate", repo);

  printTable(
    ["variante", "n", "avg ms", "p95 ms", "hit ratio", "requests-to-DB", "bytes"],
    [baseline.cells, cacheTtl.cells, cacheInvalidate.cells],
  );

  const ttlOk = cacheTtl.hitRatio >= 0.99 && cacheTtl.requestsToDb === 1;
  const invOk =
    cacheInvalidate.requestsToDb === 19 && // 1 miss inicial + 9 writes + 9 reloads
    cacheInvalidate.hitRatio < cacheTtl.hitRatio &&
    cacheInvalidate.hitRatio >= 0.98;
  const baseOk = baseline.requestsToDb === 300;

  printSummary({
    title: "Exp 4 · Medición consolidada",
    stats: [
      ["baseline", `avg ${baseline.cells[2]} ms · requests ${baseline.requestsToDb}`],
      ["cache-ttl", `avg ${cacheTtl.cells[2]} ms · hit ${(cacheTtl.hitRatio * 100).toFixed(2)}%`],
      ["cache-invalidate", `avg ${cacheInvalidate.cells[2]} ms · hit ${(cacheInvalidate.hitRatio * 100).toFixed(2)}%`],
    ],
    anomalies: [
      { text: `baseline requestsToDb === 300 (${baseline.requestsToDb})`, cls: baseOk ? "ok" : "bad" },
      { text: `cache-ttl hitRatio >= 0.99 y 1 query (${cacheTtl.requestsToDb})`, cls: ttlOk ? "ok" : "warn" },
      { text: "cache-invalidate distinto de cache-ttl (reloads medibles)", cls: invOk ? "ok" : "warn" },
    ],
    verdict: baseOk && ttlOk && invOk
      ? "Consolidado OK: la caché corta la latencia y las requests a DB; invalidar cuesta reloads"
      : "Revisar criterios (ver anomalías)",
    verdictCls: baseOk && ttlOk && invOk ? "ok" : "warn",
  });

  await closePool();
}

main().catch(async (error: unknown) => {
  console.error("\n❌ Exp 4 falló:", error);
  await closePool();
  process.exit(1);
});