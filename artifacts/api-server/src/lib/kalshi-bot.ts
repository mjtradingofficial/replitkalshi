import crypto from "crypto";
import { logger } from "./logger";

const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

export type BotStatus = "idle" | "running" | "stopped" | "error";

export interface Trade {
  id: string;
  ticker: string;
  side: "yes" | "no";
  price: number;
  count: number;
  timestamp: string;
  response: unknown;
}

export interface MarketInfo {
  ticker: string;
  expirationTime: string;
  timeLeftSeconds: number;
  yesPrice: number | null;
  noPrice: number | null;
}

export interface BotState {
  status: BotStatus;
  startedAt: string | null;
  currentMarket: MarketInfo | null;
  trades: Trade[];
  tradedMarkets: string[];
  lastError: string | null;
  lastPollAt: string | null;
  totalTrades: number;
}

function signRequest(
  method: string,
  path: string,
  body: string,
  apiKey: string,
  apiSecret: string,
): Record<string, string> {
  const timestamp = String(Date.now());
  const message = timestamp + method + path + body;

  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(message)
    .digest("base64");

  return {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": apiKey,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
}

async function kalshiGet<T>(
  path: string,
  apiKey: string,
  apiSecret: string,
): Promise<T> {
  const headers = signRequest("GET", path, "", apiKey, apiSecret);
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kalshi GET ${path} failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function kalshiPost<T>(
  path: string,
  body: object,
  apiKey: string,
  apiSecret: string,
): Promise<T> {
  const bodyStr = JSON.stringify(body);
  const headers = signRequest("POST", path, bodyStr, apiKey, apiSecret);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: bodyStr,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kalshi POST ${path} failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

interface KalshiMarket {
  ticker: string;
  expiration_time: string;
  status: string;
}

interface KalshiOrderbookLevel {
  price: number;
  quantity: number;
}

interface KalshiOrderbook {
  orderbook: {
    yes?: KalshiOrderbookLevel[];
    no?: KalshiOrderbookLevel[];
  };
}

const state: BotState = {
  status: "idle",
  startedAt: null,
  currentMarket: null,
  trades: [],
  tradedMarkets: [],
  lastError: null,
  lastPollAt: null,
  totalTrades: 0,
};

let stopRequested = false;

export function getBotState(): BotState {
  return { ...state, trades: [...state.trades] };
}

async function fetchBtcMarkets(
  apiKey: string,
  apiSecret: string,
): Promise<KalshiMarket[]> {
  const data = await kalshiGet<{ markets: KalshiMarket[] }>(
    "/markets?ticker=BTC",
    apiKey,
    apiSecret,
  );
  return (data.markets ?? []).filter((m) => m.ticker.includes("BTC"));
}

function getActiveMarket(
  markets: KalshiMarket[],
): { market: KalshiMarket; expiry: Date } | null {
  const now = new Date();
  const future = markets
    .map((m) => ({
      market: m,
      expiry: new Date(m.expiration_time),
    }))
    .filter(({ expiry }) => expiry > now);

  if (!future.length) return null;
  return future.reduce((min, cur) => (cur.expiry < min.expiry ? cur : min));
}

async function runLoop(
  apiKey: string,
  apiSecret: string,
  tradeSize: number,
  thresholdCents: number,
  windowSeconds: number,
  checkIntervalMs: number,
): Promise<void> {
  const threshold = thresholdCents / 100;

  while (!stopRequested) {
    try {
      state.lastPollAt = new Date().toISOString();

      const markets = await fetchBtcMarkets(apiKey, apiSecret);
      const active = getActiveMarket(markets);

      if (!active) {
        state.currentMarket = null;
        await sleep(1000);
        continue;
      }

      const { market, expiry } = active;
      const ticker = market.ticker;
      const timeLeftSeconds = (expiry.getTime() - Date.now()) / 1000;

      state.currentMarket = {
        ticker,
        expirationTime: expiry.toISOString(),
        timeLeftSeconds: Math.max(0, timeLeftSeconds),
        yesPrice: null,
        noPrice: null,
      };

      if (state.tradedMarkets.includes(ticker)) {
        await sleep(checkIntervalMs);
        continue;
      }

      if (timeLeftSeconds < windowSeconds) {
        const ob = await kalshiGet<KalshiOrderbook>(
          `/markets/${ticker}/orderbook`,
          apiKey,
          apiSecret,
        );

        const yesAsks = ob.orderbook?.yes ?? [];
        const noAsks = ob.orderbook?.no ?? [];

        const yesPrice = yesAsks.length > 0 ? yesAsks[0].price / 100 : null;
        const noPrice = noAsks.length > 0 ? noAsks[0].price / 100 : null;

        state.currentMarket = {
          ...state.currentMarket,
          yesPrice,
          noPrice,
        };

        logger.info(
          { ticker, timeLeftSeconds: Math.round(timeLeftSeconds), yesPrice, noPrice },
          "Orderbook snapshot",
        );

        let tradeSide: "yes" | "no" | null = null;
        let tradePrice = 0;

        if (yesPrice !== null && yesPrice >= threshold) {
          tradeSide = "yes";
          tradePrice = yesPrice;
        } else if (noPrice !== null && noPrice >= threshold) {
          tradeSide = "no";
          tradePrice = noPrice;
        }

        if (tradeSide) {
          logger.info(
            { ticker, side: tradeSide, price: tradePrice, count: tradeSize },
            "Placing order",
          );

          const orderBody = {
            ticker,
            action: "buy",
            side: tradeSide,
            type: "market",
            count: tradeSize,
          };

          const response = await kalshiPost<unknown>(
            "/orders",
            orderBody,
            apiKey,
            apiSecret,
          );

          const trade: Trade = {
            id: `${ticker}-${tradeSide}-${Date.now()}`,
            ticker,
            side: tradeSide,
            price: tradePrice,
            count: tradeSize,
            timestamp: new Date().toISOString(),
            response,
          };

          state.trades.unshift(trade);
          state.tradedMarkets.push(ticker);
          state.totalTrades += 1;

          logger.info({ trade }, "Order placed successfully");
        }
      } else {
        logger.debug(
          { ticker, timeLeftSeconds: Math.round(timeLeftSeconds) },
          "Waiting for entry window",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.lastError = msg;
      logger.error({ err: msg }, "Bot loop error");
      await sleep(1000);
    }

    await sleep(checkIntervalMs);
  }

  state.status = "stopped";
  logger.info("Bot stopped");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BotConfig {
  tradeSize?: number;
  thresholdCents?: number;
  windowSeconds?: number;
  checkIntervalMs?: number;
}

export function startBot(config: BotConfig = {}): void {
  if (state.status === "running") {
    logger.warn("Bot is already running");
    return;
  }

  const apiKey = process.env.KALSHI_API_KEY;
  const apiSecret = process.env.KALSHI_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error("KALSHI_API_KEY and KALSHI_API_SECRET must be set");
  }

  const {
    tradeSize = 10,
    thresholdCents = 99,
    windowSeconds = 120,
    checkIntervalMs = 500,
  } = config;

  stopRequested = false;
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.lastError = null;

  logger.info(
    { tradeSize, thresholdCents, windowSeconds, checkIntervalMs },
    "Starting Kalshi BTC bot",
  );

  runLoop(
    apiKey,
    apiSecret,
    tradeSize,
    thresholdCents,
    windowSeconds,
    checkIntervalMs,
  ).catch((err) => {
    state.status = "error";
    state.lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Bot crashed");
  });
}

export function stopBot(): void {
  stopRequested = true;
  logger.info("Stop requested");
}
