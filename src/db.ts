/**
 * Conexión a PostgreSQL + contador de queries (R16, R20, R25).
 *
 * Un único Pool singleton para experiments/setup/source. Los tests NUNCA
 * importan este módulo (R24: suite 100 % DB-free). El contador de queries
 * alimenta la métrica `requestsToDb` de los experimentos: se resetea DESPUÉS
 * del warm-up y se lee tras el loop medido.
 *
 * R20: todas las queries con entrada pasan por `$1/$2` (params), nunca por
 * interpolación de strings.
 */
import pg from "pg";

const { Pool } = pg;

export type DbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

/** Resuelve la config de conexión con overrides por variables de entorno. */
export function readDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  return {
    host: env.LAB_PGHOST ?? "localhost",
    port: Number(env.LAB_PGPORT ?? 55437),
    user: env.LAB_PGUSER ?? "postgres",
    password: env.LAB_PGPASSWORD ?? "lab",
    database: env.LAB_PGDATABASE ?? "lab_caching",
  };
}

/** Crea un Pool de conexiones (lazy: no conecta hasta la primera query). */
export function createPool(config: DbConfig = readDbConfig()): pg.Pool {
  return new Pool(config);
}

/** Pool singleton usado por experiments, setup y el repositorio PG. */
export const pool: pg.Pool = createPool();

let queryCount = 0;

export type QueryResult<T> = {
  rows: T[];
  duration: number;
  rowCount: number;
};

/**
 * Ejecuta una query parametrizada midiendo su duración e incrementando el
 * contador global de queries (R20: `$1/$2`, sin interpolación de entrada).
 * `targetPool` permite contar queries de pools no-singleton (repositorio PG).
 */
export async function queryWithTiming<T>(
  text: string,
  params?: unknown[],
  targetPool: pg.Pool = pool,
): Promise<QueryResult<T>> {
  queryCount += 1;
  const start = performance.now();
  const result = await targetPool.query(text, params);
  const duration = performance.now() - start;
  return {
    rows: result.rows as T[],
    duration,
    rowCount: result.rowCount ?? 0,
  };
}

/** Reinicia el contador de queries (p. ej. tras el warm-up). */
export function resetQueryCount(): void {
  queryCount = 0;
}

/** Devuelve cuántas queries se ejecutaron desde el último reset. */
export function getQueryCount(): number {
  return queryCount;
}

/** Cierra el pool singleton. */
export async function closePool(): Promise<void> {
  await pool.end();
}