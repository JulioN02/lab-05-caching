/**
 * API de funciones thin (R8, R11, R17, R22): cablean el repositorio (fuente)
 * con el caché sin lógica de negocio propia.
 *
 * - `getStockSummary` = cache-aside sobre `STOCK_SUMMARY_KEY` (R11).
 * - `updateStockQuantity` persiste y aplica la estrategia de escritura (R8):
 *   `invalidate` (por defecto, R17) borra la entrada → la próxima lectura
 *   recarga y ve el dato nuevo sin esperar el TTL (R22); `update` persiste y
 *   sobrescribe la entrada con el valor fresco → la próxima lectura es HIT sin
 *   tocar el loader.
 */
import type { Cache } from "./cache.ts";
import type { StockRepository, StockSummary } from "./source.ts";

export const STOCK_SUMMARY_KEY = "stock:summary";
export const DEFAULT_TTL_MS = 30_000;

export type WriteStrategy = "invalidate" | "update";

/** Cache-aside: miss → loader exactamente una vez; hit → sin tocar la fuente. */
export async function getStockSummary(
  dataSource: StockRepository,
  cache: Cache<StockSummary>,
  opts?: { ttlMs?: number },
): Promise<StockSummary> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  return cache.get(STOCK_SUMMARY_KEY, () => dataSource.fetchStockSummary(), ttlMs);
}

/**
 * Persiste la escritura y aplica la estrategia de caché elegida
 * (`invalidate` por defecto, R17).
 */
export async function updateStockQuantity(
  repo: StockRepository,
  sku: string,
  qty: number,
  cache: Cache<StockSummary>,
  strategy: WriteStrategy = "invalidate",
): Promise<void> {
  await repo.updateQuantity(sku, qty);
  if (strategy === "update") {
    // Estrategia update: la escritura paga 1 recomputo; la próxima lectura es HIT.
    const fresh = await repo.fetchStockSummary();
    await cache.set(STOCK_SUMMARY_KEY, fresh, DEFAULT_TTL_MS);
  } else {
    // Estrategia invalidate: escribir es barato; la próxima lectura recarga.
    await cache.invalidate(STOCK_SUMMARY_KEY);
  }
}