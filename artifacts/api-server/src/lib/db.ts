import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export interface DbSettlement {
  ticker: string;
  side: string;
  result: string;
  won: boolean;
  buyPriceCents: number;
  totalBought: number;
  soldViaStopLoss: number;
  settledCount: number;
  stopLossPnlCents: number;
  settlementPnlCents: number;
  totalPnlCents: number;
  settledAt: string;
}

export interface DbTrade {
  id: string;
  ticker: string;
  side: string;
  action: string;
  price: number;
  count: number;
  timestamp: string;
}

export async function getSettlementsFromDb(): Promise<DbSettlement[]> {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT
      ticker,
      side,
      result,
      won,
      buy_price_cents AS "buyPriceCents",
      total_bought AS "totalBought",
      sold_via_stop_loss AS "soldViaStopLoss",
      settled_count AS "settledCount",
      stop_loss_pnl_cents AS "stopLossPnlCents",
      settlement_pnl_cents AS "settlementPnlCents",
      total_pnl_cents AS "totalPnlCents",
      settled_at AS "settledAt"
    FROM settlements
    ORDER BY settled_at DESC
  `);
  return rows as DbSettlement[];
}

export async function getTradesFromDb(): Promise<DbTrade[]> {
  const db = getPool();
  const { rows } = await db.query(`
    SELECT
      id,
      ticker,
      side,
      action,
      price,
      count,
      timestamp
    FROM trades
    ORDER BY timestamp DESC
  `);
  return rows as DbTrade[];
}
