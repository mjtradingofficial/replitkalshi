import { Router, type IRouter } from "express";
import {
  getBotState,
  startBot,
  stopBot,
  type StopLossTier,
} from "../lib/kalshi-bot";
import { getSettlementsFromDb, getTradesFromDb } from "../lib/db";

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
    thresholdCents?: number;
    windowSeconds?: number;
    checkIntervalMs?: number;
    useStopLoss?: boolean;
    stopLossTiers?: StopLossTier[];
  };

  const threshold = body.thresholdCents != null
    ? body.thresholdCents / 100
    : undefined;

  startBot({
    tradeSize: body.tradeSize,
    threshold,
    windowSeconds: body.windowSeconds,
    checkIntervalMs: body.checkIntervalMs,
    useStopLoss: body.useStopLoss,
    stopLossTiers: body.stopLossTiers,
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

export default router;
