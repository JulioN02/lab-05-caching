/**
 * Cache-aside en memoria con TTL por reloj inyectable (R1–R10).
 *
 * La interfaz `Cache<T>` es async para que una implementación respaldada por
 * PostgreSQL sea drop-in sin tocar experimentos ni tests (R10). La expiración
 * es lazy (al leer): sin timers ni sweeps en background — `expiresAt > now()`
 * ⇒ hit, `expiresAt <= now()` ⇒ miss + reload (R1, R2, R6).
 */
import type { Now } from "./clock.ts";

export type CacheStats = {
  hits: number;
  misses: number;
  /** Ratio crudo (el redondeo vive en el reporter). */
  hitRatio: number;
  /** Entradas vivas en el Map (extensión para el reporte de memoria). */
  size: number;
};

export interface Cache<T> {
  /** Cache-aside: devuelve el valor; en miss invoca al loader exactamente una vez. */
  get(key: string, loader: () => Promise<T>, ttlMs: number): Promise<T>;
  /** Escribe/sobrescribe una entrada con expiración now() + ttlMs. */
  set(key: string, value: T, ttlMs: number): Promise<void>;
  /** Elimina una entrada; el siguiente get es miss (R3). */
  invalidate(key: string): Promise<void>;
  /** Elimina todas las entradas cuyo key comience con `prefix` (R4). */
  invalidatePrefix(prefix: string): Promise<void>;
  /** Estadísticas acumuladas: hits, misses, hitRatio, size (R5). */
  stats(): Promise<CacheStats>;
}

type Entry<T> = { value: T; expiresAt: number };

/** Crea un caché en memoria con expiración perezosa (R6). */
export function createInMemoryCache<T>(now: Now): Cache<T> {
  const store = new Map<string, Entry<T>>();
  let hits = 0;
  let misses = 0;

  return {
    async get(key, loader, ttlMs): Promise<T> {
      const entry = store.get(key);
      if (entry !== undefined && entry.expiresAt > now()) {
        hits += 1;
        return entry.value;
      }
      // Entrada expirada o inexistente → miss (R2: ahora() >= expiresAt borra).
      if (entry !== undefined) {
        store.delete(key);
      }
      misses += 1;
      const value = await loader();
      store.set(key, { value, expiresAt: now() + ttlMs });
      return value;
    },

    async set(key, value, ttlMs): Promise<void> {
      store.set(key, { value, expiresAt: now() + ttlMs });
    },

    async invalidate(key): Promise<void> {
      store.delete(key);
    },

    async invalidatePrefix(prefix): Promise<void> {
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          store.delete(key);
        }
      }
    },

    async stats(): Promise<CacheStats> {
      const total = hits + misses;
      return {
        hits,
        misses,
        hitRatio: total === 0 ? 0 : hits / total,
        size: store.size,
      };
    },
  };
}