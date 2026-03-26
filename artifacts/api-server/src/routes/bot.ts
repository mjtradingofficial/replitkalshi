import { Router, type IRouter } from "express";
import {
  getBotState,
  startBot,
  stopBot,
  type StopLossTier,
} from "../lib/kalshi-bot";
import { getSettlementsFromDb, getTradesFromDb, getPool } from "../lib/db";

const router: IRouter = Router();

router.get("/bot/status", async (_req, res) => {
  const state = getBotState();

  // Pull lifetime stats from DB so they survive restarts
  let totalTrades = state.totalTrades;
  let winCount = state.winCount;
  let lossCount = state.lossCount;
  let totalPnlCents = state.totalPnlCents;
  try {
    const settlements = await getSettlementsFromDb();
    winCount = settlements.filter((s) => s.won).length;
    lossCount = settlements.filter((s) => !s.won).length;
    totalPnlCents = settlements.reduce((sum, s) => sum + s.totalPnlCents, 0);
    const trades = await getTradesFromDb();
    totalTrades = trades.filter((t) => t.action === "buy").length;
  } catch {
    // Fall back to in-memory if DB unavailable
  }

  const totalClosed = winCount + lossCount;
  res.json({
    status: state.status,
    startedAt: state.startedAt,
    currentMarket: state.currentMarket,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    totalTrades,
    tradedMarkets: state.tradedMarkets,
    openPositions: state.openPositions,
    useStopLoss: state.useStopLoss,
    stopLossTiers: state.stopLossTiers,
    totalPnlCents,
    winCount,
    lossCount,
    accuracy: totalClosed > 0 ? winCount / totalClosed : null,
  });
});

router.get("/bot/settlements", async (_req, res) => {
  try {
    const settlements = await getSettlementsFromDb();
    res.json({ settlements });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.get("/bot/trades", async (_req, res) => {
  try {
    const trades = await getTradesFromDb();
    res.json({ trades });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/bot/start", (req, res) => {
  const body = req.body as {
    tradeSize?: number;
    useAllBalance?: boolean;
    thresholdCents?: number;
    windowSeconds?: number;
    checkIntervalMs?: number;
    useStopLoss?: boolean;
    stopLossTiers?: StopLossTier[];
    emaAlpha?: number;
    emaThreshold?: number;
    minTimeLeftSeconds?: number;
    useTrailingStop?: boolean;
    trailingStopCents?: number;
    maxEntryPriceCents?: number;
  };

  const threshold = body.thresholdCents != null
    ? body.thresholdCents / 100
    : undefined;

  startBot({
    tradeSize: body.tradeSize,
    useAllBalance: body.useAllBalance,
    threshold,
    windowSeconds: body.windowSeconds,
    checkIntervalMs: body.checkIntervalMs,
    useStopLoss: body.useStopLoss,
    stopLossTiers: body.stopLossTiers,
    emaAlpha: body.emaAlpha,
    emaThreshold: body.emaThreshold,
    minTimeLeftSeconds: body.minTimeLeftSeconds,
    useTrailingStop: body.useTrailingStop,
    trailingStopCents: body.trailingStopCents,
    maxEntryPriceCents: body.maxEntryPriceCents,
  })
    .then(() => {
      res.json({ success: true, message: "Bot started" });
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ success: false, message: msg });
    });
});

router.post("/bot/stop", (_req, res) => {
  stopBot();
  res.json({ success: true, message: "Stop signal sent" });
});

// Temporary one-time migration endpoint — copies dev DB data into this DB
router.post("/bot/admin/import-history", async (req, res) => {
  const token = req.headers["x-migrate-token"];
  if (token !== "kalshi-history-import-2026") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = req.body as {
    settlements?: Record<string, unknown>[];
    trades?: Record<string, unknown>[];
  };
  const db = getPool();
  let settlementsInserted = 0;
  let tradesInserted = 0;
  try {
    for (const s of body.settlements ?? []) {
      const r = await db.query(
        `INSERT INTO settlements
           (ticker, side, result, won, buy_price_cents, total_bought, sold_via_stop_loss,
            settled_count, stop_loss_pnl_cents, settlement_pnl_cents, total_pnl_cents, settled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (ticker) DO NOTHING`,
        [s.ticker, s.side, s.result, s.won, s.buy_price_cents, s.total_bought,
         s.sold_via_stop_loss, s.settled_count, s.stop_loss_pnl_cents,
         s.settlement_pnl_cents, s.total_pnl_cents, s.settled_at]
      );
      settlementsInserted += r.rowCount ?? 0;
    }
    for (const t of body.trades ?? []) {
      const r = await db.query(
        `INSERT INTO trades (id, ticker, side, action, price, count, timestamp)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, t.ticker, t.side, t.action, t.price, t.count, t.timestamp]
      );
      tradesInserted += r.rowCount ?? 0;
    }
    res.json({ success: true, settlementsInserted, tradesInserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
