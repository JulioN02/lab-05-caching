/**
 * Invariantes del lab LAB-05 (R1–R11, R17, R22) — suite 100 % DB-free (R24).
 *
 * Importa SOLO `clock.ts`, `cache.ts` y `api.ts` (nunca `db.ts`/`source.ts`);
 * la fuente de datos es un fake estructural inline con contador de llamadas.
 *
 * STRICT TDD: cada sección (clock → cache → api) se escribió ANTES de su
 * implementación (RED), se implementó el mínimo (GREEN) y se triangularizó.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createFakeClock, realNow } from "../src/clock.ts";
import { createInMemoryCache } from "../src/cache.ts";
import type { Cache } from "../src/cache.ts";
import { DEFAULT_TTL_MS, getStockSummary, STOCK_SUMMARY_KEY, updateStockQuantity } from "../src/api.ts";
import type { StockRepository, StockSummary } from "../src/source.ts";

// ---------------------------------------------------------------------------
// Suite: clock (R1, R2, R24)
// ---------------------------------------------------------------------------
describe("clock: reloj inyectable (R1/R2/R24)", () => {
  test("clock: createFakeClock(0) → now() === 0; realNow devuelve epoch ms", () => {
    const clock = createFakeClock(0);
    assert.equal(clock.now(), 0);
    const real = Date.now();
    assert.ok(Math.abs(realNow() - real) < 5, "realNow ≈ Date.now()");
  });

  test("clock: advance(delta) suma; jump(target) posiciona en absoluto", () => {
    const clock = createFakeClock(10);
    clock.advance(5);
    assert.equal(clock.now(), 15);
    clock.jump(1_000);
    assert.equal(clock.now(), 1_000);
  });

  test("clock: advance() con delta negativo lanza error", () => {
    const clock = createFakeClock(0);
    assert.throws(() => clock.advance(-1), /delta negativo/);
  });
});

// ---------------------------------------------------------------------------
// Suite: cache en memoria (R1–R7, R9, R10)
// ---------------------------------------------------------------------------
describe("cache: cache-aside con TTL en memoria (R1–R7, R9, R10)", () => {
  test("cache: TTL respetado — 1 miss + 100 gets dentro del TTL → source.calls === 1, stats.hits === 100 (R1)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<number>(clock.now);
    let calls = 0;
    const loader = async (): Promise<number> => {
      calls += 1;
      return 42;
    };
    assert.equal(await cache.get("k", loader, 30_000), 42);
    for (let i = 0; i < 100; i++) {
      clock.advance(10); // t=10..1000, siempre dentro del TTL
      assert.equal(await cache.get("k", loader, 30_000), 42, `get #${i + 1} dentro del TTL`);
    }
    assert.equal(calls, 1, "el loader se invoca una sola vez");
    const stats = await cache.stats();
    assert.equal(stats.hits, 100);
  });

  test("cache: expiración en now() >= expiresAt → miss + loader (advance exacto ttlMs) (R2)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<string>(clock.now);
    let calls = 0;
    const loader = async (): Promise<string> => {
      calls += 1;
      return `v${calls}`;
    };
    assert.equal(await cache.get("k", loader, 30_000), "v1");
    assert.equal(calls, 1);
    clock.advance(30_000); // frontera exacta: now() >= expiresAt → expira
    assert.equal(await cache.get("k", loader, 30_000), "v2");
    assert.equal(calls, 2);
    const stats = await cache.stats();
    assert.equal(stats.misses, 2);
  });

  test("cache: invalidate(key) → el siguiente get es miss (R3)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<number>(clock.now);
    let calls = 0;
    const loader = async (): Promise<number> => {
      calls += 1;
      return calls;
    };
    assert.equal(await cache.get("k", loader, 30_000), 1);
    await cache.invalidate("k");
    assert.equal(await cache.get("k", loader, 30_000), 2, "tras invalidate el get recarga");
    assert.equal(calls, 2);
  });

  test("cache: invalidatePrefix('stock:') → stock:* miss, user:1 sigue hit (R4)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<string>(clock.now);
    await cache.get("stock:a", async () => "sa", 30_000);
    await cache.get("stock:b", async () => "sb", 30_000);
    await cache.get("stock:c", async () => "sc", 30_000);
    await cache.get("user:1", async () => "u1", 30_000);
    await cache.invalidatePrefix("stock:");
    assert.equal(await cache.get("stock:a", async () => "SA", 30_000), "SA", "stock:a recarga");
    assert.equal(await cache.get("stock:b", async () => "SB", 30_000), "SB", "stock:b recarga");
    assert.equal(await cache.get("stock:c", async () => "SC", 30_000), "SC", "stock:c recarga");
    assert.equal(await cache.get("user:1", async () => "u1", 30_000), "u1", "user:1 sigue hit");
    const stats = await cache.stats();
    assert.equal(stats.misses, 7); // 4 misses iniciales + 3 recargas de stock:*
    assert.equal(stats.hits, 1); // solo user:1
  });

  test("cache: stats/hitRatio — 3 hits + 1 miss → {hits:3, misses:1, hitRatio:0.75}; 0 sin lecturas (R5)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<number>(clock.now);
    const loader = async (): Promise<number> => 7;
    await cache.get("k", loader, 30_000); // miss
    await cache.get("k", loader, 30_000); // hit
    await cache.get("k", loader, 30_000); // hit
    await cache.get("k", loader, 30_000); // hit
    const stats = await cache.stats();
    assert.equal(stats.hits, 3);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRatio, 0.75);
    const empty = await createInMemoryCache<number>(clock.now).stats();
    assert.equal(empty.hitRatio, 0, "sin lecturas → hitRatio 0");
  });

  test("cache: cache-aside — miss→populate exactamente 1 vez + 5 hits → source.calls === 1 (R6)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<number>(clock.now);
    let calls = 0;
    const loader = async (): Promise<number> => {
      calls += 1;
      return 1;
    };
    await cache.get("k", loader, 30_000);
    for (let i = 0; i < 5; i++) {
      await cache.get("k", loader, 30_000);
    }
    assert.equal(calls, 1, "1 populate + 5 hits → 1 sola llamada al loader");
  });

  test("cache: ventana de staleness — get antes del TTL → v1; tras el TTL → v2 (R7)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<string>(clock.now);
    let current = "v1";
    const loader = async (): Promise<string> => current;
    assert.equal(await cache.get("k", loader, 30_000), "v1"); // populate
    current = "v2"; // la fuente cambia; el caché no lo sabe
    clock.advance(10_000); // dentro del TTL
    assert.equal(await cache.get("k", loader, 30_000), "v1", "stale: sigue v1 dentro del TTL");
    clock.advance(20_001); // t=30001 > expiresAt(30000)
    assert.equal(await cache.get("k", loader, 30_000), "v2", "tras el TTL se ve v2");
  });

  test("cache: valor cacheado deep-equal al resultado del loader (R9)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<{ totalItems: number; byCategory: Array<{ category: string; items: number }> }>(
      clock.now,
    );
    const loader = async () => ({
      totalItems: 10,
      byCategory: [{ category: "A", items: 10 }],
    });
    const first = await cache.get("k", loader, 30_000);
    const second = await cache.get("k", loader, 30_000); // hit
    assert.deepEqual(second, first, "el hit devuelve la misma estructura");
    assert.deepEqual(second, await loader(), "deep-equal con el resultado del loader");
  });

  test("cache: interfaz async — get/set/invalidate/invalidatePrefix/stats devuelven Promise (R10)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<number>(clock.now);
    // Runtime: cada operación devuelve una Promise real (se awaita para evitar
    // microtasks diferidas que pisarían valores posteriores).
    const pGet = cache.get("k", async () => 1, 30_000);
    assert.ok(pGet instanceof Promise);
    assert.equal(await pGet, 1);
    const pSet = cache.set("k", 1, 30_000);
    assert.ok(pSet instanceof Promise);
    await pSet;
    const pInvalidate = cache.invalidate("k");
    assert.ok(pInvalidate instanceof Promise);
    await pInvalidate;
    const pInvalidatePrefix = cache.invalidatePrefix("s");
    assert.ok(pInvalidatePrefix instanceof Promise);
    await pInvalidatePrefix;
    const pStats = cache.stats();
    assert.ok(pStats instanceof Promise);
    await pStats;
    // Type-level: la interfaz Cache<T> existe y es inyectable (compila si y solo si).
    const typed: Cache<number> = cache;
    await typed.set("k", 2, 30_000);
    assert.equal(await typed.get("k", async () => 9, 30_000), 2, "set → get devuelve el valor seteado");
  });
});

// ---------------------------------------------------------------------------
// Fake estructural de la fuente (R24: nunca se importa source.ts en tests)
// ---------------------------------------------------------------------------
const V1: StockSummary = {
  totalItems: 3,
  totalQuantity: 100,
  byCategory: [{ category: "A", items: 3, quantity: 100 }],
};

type FakeStockRepository = StockRepository & {
  calls: number;
  writeCalls: number;
  setSummary: (v: StockSummary) => void;
};

function createFakeStockRepository(initial: StockSummary): FakeStockRepository {
  let summary = initial;
  const repo = {
    calls: 0,
    writeCalls: 0,
    async fetchStockSummary(): Promise<StockSummary> {
      repo.calls += 1;
      return summary;
    },
    async updateQuantity(sku: string, qty: number): Promise<void> {
      repo.writeCalls += 1;
      summary = { ...summary, totalQuantity: qty };
    },
    setSummary(v: StockSummary): void {
      summary = v;
    },
  };
  return repo;
}

// ---------------------------------------------------------------------------
// Suite: api (R8, R11, R17, R22)
// ---------------------------------------------------------------------------
describe("api: funciones thin getStockSummary / updateStockQuantity (R8, R11, R17, R22)", () => {
  test("api: getStockSummary — miss→loader, hit→sin llamada a la fuente; shape estable (R11)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<StockSummary>(clock.now);
    const repo = createFakeStockRepository(V1);
    const first = await getStockSummary(repo, cache);
    assert.equal(repo.calls, 1, "miss → loader una vez");
    assert.deepEqual(first, V1);
    assert.equal(first.totalItems, 3);
    assert.equal(first.totalQuantity, 100);
    assert.ok(Array.isArray(first.byCategory) && first.byCategory.length === 1);
    const second = await getStockSummary(repo, cache);
    assert.deepEqual(second, first, "hit → mismo valor");
    assert.equal(repo.calls, 1, "hit → sin llamada a la fuente");
  });

  test("api: STOCK_SUMMARY_KEY === 'stock:summary' y DEFAULT_TTL_MS === 30000; get sin opts usa TTL default (R11)", async () => {
    assert.equal(STOCK_SUMMARY_KEY, "stock:summary");
    assert.equal(DEFAULT_TTL_MS, 30_000);
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<StockSummary>(clock.now);
    const repo = createFakeStockRepository(V1);
    await getStockSummary(repo, cache); // sin opts → TTL por defecto
    clock.advance(DEFAULT_TTL_MS - 1); // dentro del TTL default
    assert.deepEqual(await getStockSummary(repo, cache), V1, "hit con TTL default");
    assert.equal(repo.calls, 1);
  });

  test("api: updateStockQuantity invalidate → write + read: loader 1 vez, dato fresco SIN avanzar TTL (R17/R22)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<StockSummary>(clock.now);
    const repo = createFakeStockRepository(V1);
    await getStockSummary(repo, cache); // populate v1 (miss)
    assert.equal(repo.calls, 1);
    await updateStockQuantity(repo, "SKU-0000001", 999, cache, "invalidate");
    assert.equal(repo.writeCalls, 1);
    assert.equal(repo.calls, 1, "la escritura con invalidate NO lee la fuente");
    const fresh = await getStockSummary(repo, cache); // miss tras invalidate → loader 1 vez
    assert.equal(repo.calls, 2);
    assert.equal(fresh.totalQuantity, 999, "el lector ve el dato nuevo");
    assert.equal(clock.now(), 0, "el TTL no avanzó: la frescura no depende de la expiración");
  });

  test("api: updateStockQuantity update → write + read: HIT con valor fresco, 0 llamadas al loader en la lectura (R8)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<StockSummary>(clock.now);
    const repo = createFakeStockRepository(V1);
    await getStockSummary(repo, cache); // populate v1
    await updateStockQuantity(repo, "SKU-0000001", 777, cache, "update");
    assert.equal(repo.writeCalls, 1);
    assert.equal(repo.calls, 2, "update: persiste + 1 recompute de lectura");
    const fresh = await getStockSummary(repo, cache); // HIT → 0 llamadas al loader
    assert.equal(repo.calls, 2, "la lectura tras update NO recarga");
    assert.equal(fresh.totalQuantity, 777, "valor fresco servido como HIT");
  });

  test("api: updateStockQuantity por defecto usa 'invalidate' (R17)", async () => {
    const clock = createFakeClock(0);
    const cache = createInMemoryCache<StockSummary>(clock.now);
    const repo = createFakeStockRepository(V1);
    await getStockSummary(repo, cache); // populate v1
    await updateStockQuantity(repo, "SKU-0000001", 555, cache); // sin strategy → invalidate
    assert.equal(repo.writeCalls, 1);
    assert.equal(await (await getStockSummary(repo, cache)).totalQuantity, 555, "recarga tras invalidate default");
    assert.equal(repo.calls, 2);
  });

  test("api: contraste — invalidate recarga en la lectura; update no (mismo dato fresco, distinto costo) (R8/R22)", async () => {
    const clock = createFakeClock(0);
    // invalidate
    const cacheInv = createInMemoryCache<StockSummary>(clock.now);
    const repoInv = createFakeStockRepository(V1);
    await getStockSummary(repoInv, cacheInv);
    await updateStockQuantity(repoInv, "SKU-0000001", 111, cacheInv, "invalidate");
    const readInv = await getStockSummary(repoInv, cacheInv);
    assert.equal(readInv.totalQuantity, 111);
    assert.equal(repoInv.calls, 2, "invalidate: 1 populate + 1 recarga");
    // update
    const cacheUpd = createInMemoryCache<StockSummary>(clock.now);
    const repoUpd = createFakeStockRepository(V1);
    await getStockSummary(repoUpd, cacheUpd);
    await updateStockQuantity(repoUpd, "SKU-0000001", 222, cacheUpd, "update");
    const readUpd = await getStockSummary(repoUpd, cacheUpd);
    assert.equal(readUpd.totalQuantity, 222);
    assert.equal(repoUpd.calls, 2, "update: 1 populate + 1 recompute en write (0 en la lectura)");
  });
});