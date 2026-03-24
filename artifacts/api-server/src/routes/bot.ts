import { Router, type IRouter } from "express";
import {
  getBotState,
  startBot,
  stopBot,
  type StopLossTier,
} from "../lib/kalshi-bot";

const router: IRouter = Router();

router.get("/bot/status", (_req, res) => {
  const state = getBotState();
  const totalClosed = state.winCount + state.lossCount;
  res.json({
    status: state.status,
    startedAt: state.startedAt,
    currentMarket: state.currentMarket,
    lastPollAt: state.lastPollAt,
    lastError: state.lastError,
    totalTrades: state.totalTrades,
    tradedMarkets: state.tradedMarkets,
    openPositions: state.openPositions,
    useStopLoss: state.useStopLoss,
    stopLossTiers: state.stopLossTiers,
    totalPnlCents: state.totalPnlCents,
    winCount: state.winCount,
    lossCount: state.lossCount,
    accuracy: totalClosed > 0 ? state.winCount / totalClosed : null,
  });
});

router.get("/bot/settlements", (_req, res) => {
  const state = getBotState();
  res.json({ settlements: state.settlements });
});

router.get("/bot/trades", (_req, res) => {
  const state = getBotState();
  res.json({ trades: state.trades });
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
