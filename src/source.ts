/**
 * Seam de repositorio (R11, R17, R20, R24) — el ÚNICO punto de contacto con
 * PostgreSQL para la API. `StockRepository` es la interfaz inyectable que los
 * tests ejercitan con un fake estructural (nunca se importa este módulo en
 * tests, R24); la implementación PG real queda demostrada por los experiments.
 */
import type pg from "pg";

import { queryWithTiming } from "./db.ts";

export type CategorySummary = {
  category: string;
  items: number;
  quantity: number;
};

export type StockSummary = {
  totalItems: number;
  totalQuantity: number;
  byCategory: CategorySummary[];
};

export interface StockRepository {
  /** Agregado de stock: UNA query GROUP BY; totales derivados en JS (R11). */
  fetchStockSummary(): Promise<StockSummary>;
  /** Escribe quantity para un sku; throw si el sku no existe (R17, R20). */
  updateQuantity(sku: string, qty: number): Promise<void>;
}

type CategoryRow = {
  category: string;
  items: number;
  quantity: string; // SUM(bigint) → node-postgres lo entrega como string
};

/** Implementación PG real: 1 round-trip por fetch (R11, R20). */
export function createPgStockRepository(pool: pg.Pool): StockRepository {
  return {
    async fetchStockSummary(): Promise<StockSummary> {
      const { rows } = await queryWithTiming<CategoryRow>(
        `SELECT category, COUNT(*)::int AS items, SUM(quantity) AS quantity
           FROM stock_items
          GROUP BY category
          ORDER BY category`,
        undefined,
        pool,
      );
      const byCategory: CategorySummary[] = rows.map((row) => ({
        category: row.category,
        // Number(): el SUM(bigint) llega como string; ::int desbordaría a 5M filas.
        items: Number(row.items),
        quantity: Number(row.quantity),
      }));
      const totalItems = byCategory.reduce((acc, c) => acc + c.items, 0);
      const totalQuantity = byCategory.reduce((acc, c) => acc + c.quantity, 0);
      return { totalItems, totalQuantity, byCategory };
    },

    async updateQuantity(sku: string, qty: number): Promise<void> {
      const { rowCount } = await queryWithTiming(
        "UPDATE stock_items SET quantity = $2, updated_at = now() WHERE sku = $1",
        [sku, qty],
        pool,
      );
      if (rowCount === 0) {
        throw new Error(`SKU no encontrado: ${sku}`);
      }
    },
  };
}