import crypto from "crypto";
import fs from "fs";
import path from "path";
import { logger } from "./logger";

const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";
const TRADES_FILE = path.resolve("./data/trades.json");

function loadPrivateKey(secret: string): crypto.KeyObject {
  const cleanBase64 = secret.replace(/\s+/g, "");
  const pem =
    "-----BEGIN RSA PRIVATE KEY-----\n" +
    (cleanBase64.match(/.{1,64}/g) ?? []).join("\n") +
    "\n-----END RSA PRIVATE KEY-----";
  return crypto.createPrivateKey(pem);
}

export type BotStatus = "idle" | "running" | "stopped" | "error";
export type TradeAction = "buy" | "stop-loss-sell";

export interface Trade {
  id: string;
  ticker: string;
  side: "yes" | "no";
  action: TradeAction;
  price: number;
  count: number;
  timestamp: string;
  response: unknown;
}

export interface Position {
  ticker: string;
  side: "yes" | "no";
  count: number;
  boughtAt: number;
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
  openPositions: Position[];
  stopLossPrice: number;
  lastError: string | null;
  lastPollAt: string | null;
  totalTrades: number;
}

// --- Trade persistence ---
function loadTrades(): Trade[] {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      const raw = fs.readFileSync(TRADES_FILE, "utf-8");
      return JSON.parse(raw) as Trade[];
    }
  } catch {
    // ignore
  }
  return [];
}

function saveTrades(trades: Trade[]): void {
  try {
    fs.mkdirSync(path.dirname(TRADES_FILE), { recursive: true });
    fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
  } catch (err) {
    logger.warn({ err }, "Failed to persist trades");
  }
}

const API_PATH_PREFIX = "/trade-api/v2";

function signRequest(
  method: string,
  path: string,
  _body: string,
  apiKey: string,
  privateKey: crypto.KeyObject,
): Record<string, string> {
  const timestamp = String(Date.now());
  const fullPath = API_PATH_PREFIX + path;
  const message = timestamp + method + fullPath;
  const signature = crypto
    .sign("sha256", Buffer.from(message), {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
    .toString("base64");
  return {
    "Content-Type": "application/json",
    "KALSHI-ACCESS-KEY": apiKey,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
}

async function kalshiPublicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kalshi GET ${path} failed ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function kalshiAuthGet<T>(
  path: string,
  apiKey: string,
  privateKey: crypto.KeyObject,
): Promise<T> {
  const headers = signRequest("GET", path, "", apiKey, privateKey);
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
  privateKey: crypto.KeyObject,
): Promise<T> {
  const bodyStr = JSON.stringify(body);
  const headers = signRequest("POST", path, bodyStr, apiKey, privateKey);
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
  close_time: string;
  expiration_time: string;
  status: string;
}

interface KalshiOrderbookFp {
  orderbook_fp: {
    yes_dollars?: [string, string][];
    no_dollars?: [string, string][];
  };
}

const state: BotState = {
  status: "idle",
  startedAt: null,
  currentMarket: null,
  trades: loadTrades(),
  tradedMarkets: [],
  openPositions: [],
  stopLossPrice: 0.80,
  lastError: null,
  lastPollAt: null,
  totalTrades: 0,
};

let stopRequested = false;

export function getBotState(): BotState {
  return {
    ...state,
    trades: [...state.trades],
    openPositions: [...state.openPositions],
  };
}

async function fetchOpenBtc15mMarkets(): Promise<KalshiMarket[]> {
  const results: KalshiMarket[] = [];
  let cursor = "";
  let pages = 0;

  while (pages < 5) {
    const qs = `/markets?series_ticker=KXBTC15M&status=open&limit=100${cursor ? `&cursor=${cursor}` : ""}`;
    const data = await kalshiPublicGet<{
      markets: KalshiMarket[];
      cursor?: string;
    }>(qs);

    results.push(...(data.markets ?? []));
    cursor = data.cursor ?? "";
    pages++;
    if (!cursor) break;
  }

  return results;
}

async function getOrderbookPrices(
  ticker: string,
): Promise<{ yesPrice: number | null; noPrice: number | null }> {
  const ob = await kalshiPublicGet<KalshiOrderbookFp>(
    `/markets/${ticker}/orderbook`,
  );

  const yesDollars = ob.orderbook_fp?.yes_dollars ?? [];
  const noDollars = ob.orderbook_fp?.no_dollars ?? [];

  const yesPrice =
    yesDollars.length > 0
      ? parseFloat(yesDollars[yesDollars.length - 1][0])
      : null;
  const noPrice =
    noDollars.length > 0
      ? parseFloat(noDollars[noDollars.length - 1][0])
      : null;

  return { yesPrice, noPrice };
}

function recordTrade(trade: Trade): void {
  state.trades.unshift(trade);
  saveTrades(state.trades);
}

async function runLoop(
  apiKey: string,
  privateKey: crypto.KeyObject,
  tradeSize: number,
  threshold: number,
  windowSeconds: number,
  checkIntervalMs: number,
): Promise<void> {
  let displayRefreshTick = 0;
  const DISPLAY_REFRESH_EVERY = 10;

  while (!stopRequested) {
    try {
      state.lastPollAt = new Date().toISOString();
      displayRefreshTick++;

      const markets = await fetchOpenBtc15mMarkets();
      const now = new Date();

      const withTiming = markets.map((m) => ({
        market: m,
        closeAt: new Date(m.close_time),
        timeLeftSeconds: (new Date(m.close_time).getTime() - now.getTime()) / 1000,
      }));

      // --- Stop loss check: monitor all open positions ---
      for (const pos of [...state.openPositions]) {
        const mkt = withTiming.find((w) => w.market.ticker === pos.ticker);

        // Market expired — position settled, remove it
        if (!mkt || mkt.timeLeftSeconds <= 0) {
          state.openPositions = state.openPositions.filter(
            (p) => p.ticker !== pos.ticker,
          );
          logger.info({ ticker: pos.ticker }, "Position expired/settled, removed");
          continue;
        }

        // Check current price of the side we hold
        try {
          const { yesPrice, noPrice } = await getOrderbookPrices(pos.ticker);
          const currentPrice = pos.side === "yes" ? yesPrice : noPrice;

          if (currentPrice !== null && currentPrice <= state.stopLossPrice) {
            const sellPriceInCents = Math.max(1, Math.floor(currentPrice * 100));
            logger.warn(
              { ticker: pos.ticker, side: pos.side, currentPrice, stopLossPrice: state.stopLossPrice, sellPriceInCents },
              "Stop loss triggered — selling position",
            );

            const sellBody = {
              ticker: pos.ticker,
              action: "sell",
              side: pos.side,
              type: "limit",
              count: pos.count,
              ...(pos.side === "yes"
                ? { yes_price: sellPriceInCents }
                : { no_price: sellPriceInCents }),
            };

            try {
              const response = await kalshiPost<unknown>(
                "/portfolio/orders",
                sellBody,
                apiKey,
                privateKey,
              );

              const sellTrade: Trade = {
                id: `${pos.ticker}-${pos.side}-sell-${Date.now()}`,
                ticker: pos.ticker,
                side: pos.side,
                action: "stop-loss-sell",
                price: currentPrice,
                count: pos.count,
                timestamp: new Date().toISOString(),
                response,
              };

              recordTrade(sellTrade);
              state.totalTrades += 1;
              state.openPositions = state.openPositions.filter(
                (p) => p.ticker !== pos.ticker,
              );
              logger.info({ sellTrade }, "Stop loss sell placed successfully");
            } catch (sellErr) {
              const msg = sellErr instanceof Error ? sellErr.message : String(sellErr);
              logger.error({ err: msg, pos }, "Stop loss sell order failed");
            }
          }
        } catch {
          // ignore price fetch error for this position tick
        }
      }

      // --- Identify nearest market for display ---
      const inWindow = withTiming
        .filter(
          ({ timeLeftSeconds, market }) =>
            timeLeftSeconds > 0 &&
            timeLeftSeconds < windowSeconds &&
            !state.tradedMarkets.includes(market.ticker),
        )
        .sort((a, b) => a.timeLeftSeconds - b.timeLeftSeconds);

      const nearest = withTiming
        .filter(({ timeLeftSeconds }) => timeLeftSeconds > 0)
        .sort((a, b) => a.timeLeftSeconds - b.timeLeftSeconds)[0];

      if (nearest) {
        let displayYes =
          state.currentMarket?.ticker === nearest.market.ticker
            ? state.currentMarket.yesPrice
            : null;
        let displayNo =
          state.currentMarket?.ticker === nearest.market.ticker
            ? state.currentMarket.noPrice
            : null;

        const shouldRefreshDisplay =
          displayYes === null ||
          displayNo === null ||
          displayRefreshTick % DISPLAY_REFRESH_EVERY === 0;

        if (shouldRefreshDisplay) {
          try {
            const prices = await getOrderbookPrices(nearest.market.ticker);
            displayYes = prices.yesPrice;
            displayNo = prices.noPrice;
          } catch {
            // keep existing values
          }
        }

        state.currentMarket = {
          ticker: nearest.market.ticker,
          expirationTime: nearest.closeAt.toISOString(),
          timeLeftSeconds: Math.max(0, nearest.timeLeftSeconds),
          yesPrice: displayYes,
          noPrice: displayNo,
        };
      } else {
        state.currentMarket = null;
      }

      if (inWindow.length === 0) {
        if (nearest) {
          logger.debug(
            {
              ticker: nearest.market.ticker,
              timeLeftSeconds: Math.round(nearest.timeLeftSeconds),
            },
            "Watching market, not in window yet",
          );
        } else {
          logger.debug("No open KXBTC15M markets found");
        }
        await sleep(checkIntervalMs);
        continue;
      }

      // --- Buy check ---
      for (const { market, timeLeftSeconds } of inWindow) {
        if (stopRequested) break;
        const ticker = market.ticker;

        const { yesPrice, noPrice } = await getOrderbookPrices(ticker);

        if (state.currentMarket?.ticker === ticker) {
          state.currentMarket = { ...state.currentMarket, yesPrice, noPrice };
        }

        logger.info(
          { ticker, timeLeftSeconds: Math.round(timeLeftSeconds), yesPrice, noPrice, threshold },
          "Orderbook check",
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
          // Kalshi prices must be 1-99 cents; use floor to avoid 100
          const priceInCents = Math.min(99, Math.max(1, Math.floor(tradePrice * 100)));

          let contractCount = tradeSize;
          try {
            const balanceResp = await kalshiAuthGet<{ balance: number }>(
              "/portfolio/balance",
              apiKey,
              privateKey,
            );
            const balanceCents = balanceResp.balance;
            contractCount = Math.max(1, Math.floor(balanceCents / priceInCents));
            logger.info({ balanceCents, priceInCents, contractCount }, "Calculated max contracts from balance");
          } catch (balErr) {
            logger.warn({ err: balErr }, "Could not fetch balance, using fallback tradeSize");
          }

          logger.info(
            { ticker, side: tradeSide, price: tradePrice, priceInCents, count: contractCount },
            "Placing order",
          );

          const orderBody = {
            ticker,
            action: "buy",
            side: tradeSide,
            type: "limit",
            count: contractCount,
            ...(tradeSide === "yes"
              ? { yes_price: priceInCents }
              : { no_price: priceInCents }),
          };

          try {
            const response = await kalshiPost<unknown>(
              "/portfolio/orders",
              orderBody,
              apiKey,
              privateKey,
            );

            const trade: Trade = {
              id: `${ticker}-${tradeSide}-${Date.now()}`,
              ticker,
              side: tradeSide,
              action: "buy",
              price: tradePrice,
              count: contractCount,
              timestamp: new Date().toISOString(),
              response,
            };

            recordTrade(trade);
            state.tradedMarkets.push(ticker);
            state.totalTrades += 1;

            // Track this as an open position for stop loss monitoring
            state.openPositions.push({
              ticker,
              side: tradeSide,
              count: contractCount,
              boughtAt: tradePrice,
            });

            logger.info({ trade }, "Order placed successfully");
          } catch (orderErr) {
            const msg = orderErr instanceof Error ? orderErr.message : String(orderErr);
            state.lastError = msg;
            logger.error({ err: msg, ticker, side: tradeSide, priceInCents, contractCount }, "Order failed — will retry next check");
          }
        }
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
  threshold?: number;
  windowSeconds?: number;
  checkIntervalMs?: number;
  stopLossPrice?: number;
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

  const privateKey = loadPrivateKey(apiSecret);

  const {
    tradeSize = 10,
    threshold = 0.97,
    windowSeconds = 180,
    checkIntervalMs = 500,
    stopLossPrice = 0.80,
  } = config;

  stopRequested = false;
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.lastError = null;
  state.stopLossPrice = stopLossPrice;

  logger.info(
    { tradeSize, threshold, windowSeconds, checkIntervalMs, stopLossPrice },
    "Starting Kalshi BTC15M bot (RSA-PSS auth)",
  );

  runLoop(
    apiKey,
    privateKey,
    tradeSize,
    threshold,
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
