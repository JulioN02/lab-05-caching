/**
 * Exp 1 · Línea base (R12, R13): N lecturas DIRECTAS a PostgreSQL, sin caché.
 *
 * Mide latencia avg/p95/p99 y verifica que requestsToDb === N (1 query por
 * request). El warm-up se descarta y el contador se resetea DESPUÉS de él
 * (R13), antes del loop medido.
 */
import { closePool, getQueryCount, pool, queryWithTiming, resetQueryCount } from "./db.ts";
import { createPgStockRepository } from "./source.ts";
import { measureReads } from "./evidence.ts";
import { printBanner, printSummary } from "./reporter.ts";

async function main(): Promise<void> {
  const n = Number(process.env.LAB_REQUESTS ?? 300);
  printBanner("LAB-05 · Exp 1 · Línea base — lectura directa a PostgreSQL");

  // Fail-fast: la DB debe estar viva (docker compose up -d db + db:setup).
  await queryWithTiming("SELECT 1");
  const repo = createPgStockRepository(pool);

  // Warm-up descartada (R13) y reset del contador ANTES del loop medido.
  await repo.fetchStockSummary();
  resetQueryCount();

  const report = await measureReads(
    async (): Promise<void> => {
      await repo.fetchStockSummary();
    },
    n,
    0,
  );
  const requestsToDb = getQueryCount();

  const ok = requestsToDb === n;
  printSummary({
    title: "Exp 1 · Línea base",
    stats: [
      ["n", String(report.n)],
      ["avg ms", String(report.avgMs)],
      ["p95 ms", String(report.p95Ms)],
      ["p99 ms", String(report.p99Ms)],
      ["requestsToDb", String(requestsToDb)],
    ],
    anomalies: [
      {
        text: `requestsToDb === n (${requestsToDb} === ${n})`,
        cls: ok ? "ok" : "bad",
      },
    ],
    verdict: ok ? "Baseline OK: 1 query por request (sin caché)" : "Baseline inesperado",
    verdictCls: ok ? "ok" : "bad",
  });

  await closePool();
}

main().catch(async (error: unknown) => {
  console.error("\n❌ Exp 1 falló:", error);
  await closePool();
  process.exit(1);
});