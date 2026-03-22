import { Router, type IRouter } from "express";
import {
  getBotState,
  startBot,
  stopBot,
} from "../lib/kalshi-bot";

const router: IRouter = Router();

router.get("/bot/status", (_req, res) => {
  const state = getBotState();
  res.json({
    status: state.status,
    startedAt: state.startedAt,
    currentMarket: state.currentMarket,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    totalTrades: state.totalTrades,
    tradedMarkets: state.tradedMarkets,
  });
});

router.get("/bot/trades", (_req, res) => {
  const state = getBotState();
  res.json({ trades: state.trades });
});

router.post("/bot/start", (req, res) => {
  const {
    tradeSize,
    threshold,
    windowSeconds,
    checkIntervalMs,
  } = req.body as Record<string, number | undefined>;

  try {
    startBot({ tradeSize, threshold, windowSeconds, checkIntervalMs });
    res.json({ success: true, message: "Bot started" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, message: msg });
  }
});

router.post("/bot/stop", (_req, res) => {
  stopBot();
  res.json({ success: true, message: "Stop signal sent" });
});

export default router;
