/**
 * Aprovisionamiento de la base de datos del lab (R18, R19, R25).
 *
 * Flags:
 *   (default)   `npm run db:setup`  → asegura DB + migra + seed si count != LAB_ROWS
 *   --reseed    `npm run db:seed`   → fuerza TRUNCATE + seed a LAB_ROWS
 *   --fresh     `npm run db:reset`  → pg_terminate_backend + DROP + recrea + migra + seed
 *
 * El seed es SQL puro y determinista (`generate_series(1, $1)`, parametrizado
 * R20): mismo LAB_ROWS ⇒ mismos datos. Al final imprime `pg_indexes` para dejar
 * evidencia de que NO existe índice sobre `category` (R18).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { pool, readDbConfig, closePool } from "./db.ts";

const { Pool } = pg;

const DEFAULT_ROWS = 1_000_000;
const CATEGORIES = [
  "Electronics",
  "Clothing",
  "Books",
  "Home",
  "Sports",
  "Toys",
  "Food",
  "Health",
  "Automotive",
  "Garden",
] as const;

function readRows(): number {
  const raw = process.env.LAB_ROWS;
  const n = raw === undefined ? DEFAULT_ROWS : Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`LAB_ROWS inválido: ${raw ?? "(default)"} — se espera un entero > 0`);
  }
  return n;
}

/** Asegura que la base objetivo exista (conecta a la base de mantenimiento). */
async function ensureDatabase(fresh: boolean): Promise<void> {
  const config = readDbConfig();
  const admin = new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: "postgres",
  });
  const client = await admin.connect();
  try {
    if (fresh) {
      await client.query(
        `SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [config.database],
      );
      await client.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(config.database)}`);
      console.log(`  ✅ Base "${config.database}" eliminada (--fresh)`);
    }
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      config.database,
    ]);
    if (exists.rows.length === 0) {
      await client.query(`CREATE DATABASE ${pg.escapeIdentifier(config.database)}`);
      console.log(`  ✅ Base "${config.database}" creada`);
    } else {
      console.log(`  ✅ Base "${config.database}" ya existe`);
    }
  } finally {
    client.release();
    await admin.end();
  }
}

/** Aplica la migración 001_schema.sql (idempotente: CREATE TABLE IF NOT EXISTS). */
async function applyMigration(): Promise<void> {
  const migrationPath = fileURLToPath(new URL("../migrations/001_schema.sql", import.meta.url));
  const sql = readFileSync(migrationPath, "utf8");
  await pool.query(sql);
  console.log("  ✅ Migración 001_schema.sql aplicada");
}

/** Cuenta las filas actuales de stock_items. */
async function countRows(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM stock_items",
  );
  const row = result.rows[0];
  return row === undefined ? 0 : Number(row.count);
}

/** TRUNCATE + seed determinista de LAB_ROWS filas (R19). */
async function seed(rows: number): Promise<void> {
  console.log(`  🔄 Seed de ${rows.toLocaleString("en-US")} filas...`);
  await pool.query("TRUNCATE stock_items RESTART IDENTITY");
  await pool.query(
    `INSERT INTO stock_items (sku, category, quantity)
     SELECT
       'SKU-' || lpad(g::text, 7, '0'),
       (ARRAY[${CATEGORIES.map((c) => `'${c}'`).join(", ")}])[1 + (g % 10)],
       ((g * 7 + 13) % 1000) + 1
     FROM generate_series(1, $1) AS g`,
    [rows],
  );
  await pool.query("ANALYZE stock_items");
  console.log("  ✅ Seed completado + ANALYZE");
}

/** Imprime los índices de stock_items (evidencia R18: sin índice de category). */
async function printIndexes(): Promise<void> {
  const result = await pool.query<{ indexname: string; indexdef: string }>(
    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'stock_items' ORDER BY indexname",
  );
  console.log("  📊 Índices de stock_items:");
  for (const row of result.rows) {
    console.log(`     · ${row.indexname}: ${row.indexdef}`);
  }
  const hasCategoryIndex = result.rows.some((r) => r.indexdef.includes("(category)"));
  console.log(
    hasCategoryIndex
      ? "     ⚠️  Se encontró un índice sobre category (R18 violado)"
      : "     ✅ Sin índice sobre category (R18 respetado)",
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fresh = args.includes("--fresh");
  const reseed = args.includes("--reseed");
  const rows = readRows();

  console.log("═".repeat(60));
  console.log("LAB-05 · Setup de base de datos");
  console.log("═".repeat(60));
  console.log(`  LAB_ROWS = ${rows.toLocaleString("en-US")}`);

  await ensureDatabase(fresh);
  await applyMigration();

  const current = await countRows();
  const needsSeed = fresh || reseed || current !== rows;
  if (needsSeed) {
    await seed(rows);
  } else {
    console.log(`  ✅ Ya hay ${current.toLocaleString("en-US")} filas — sin reseed (idempotente)`);
  }

  const finalCount = await countRows();
  if (finalCount !== rows) {
    throw new Error(`Verificación falló: count=${finalCount}, esperado=${rows}`);
  }
  console.log(`  ✅ count(*) = ${finalCount.toLocaleString("en-US")} == LAB_ROWS`);
  await printIndexes();
  console.log("═".repeat(60));
  console.log("✅ Setup completado exitosamente");
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("\n❌ Setup falló:", error);
    await closePool();
    process.exit(1);
  });