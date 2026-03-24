import crypto from "crypto";
import { logger } from "./logger";

const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

// Load RSA private key once. The env var is a base64-encoded PKCS#1 DER private key
// (spaces are present because PEM newlines were replaced with spaces when stored).
// Kalshi uses RSA-PSS (SHA-256, saltLength=32) for request signing.
function loadPrivateKey(secret: string): crypto.KeyObject {
  const cleanBase64 = secret.replace(/\s+/g, "");
  const pem =
    "-----BEGIN RSA PRIVATE KEY-----\n" +
    (cleanBase64.match(/.{1,64}/g) ?? []).join("\n") +
    "\n-----END RSA PRIVATE KEY-----";
  return crypto.createPrivateKey(pem);
}

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

const API_PATH_PREFIX = "/trade-api/v2";

function signRequest(
  method: string,
  path: string,
  body: string,
  apiKey: string,
  privateKey: crypto.KeyObject,
): Record<string, string> {
  const timestamp = String(Date.now());
  // Kalshi requires the full path including /trade-api/v2 in the signed message
  const fullPath = API_PATH_PREFIX + path;
  const message = timestamp + method + fullPath + body;
  // Kalshi Elections API: RSA-PSS with SHA-256, salt length = 32 (digest size)
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

// Public (unauthenticated) GET — used for markets and orderbooks which are public
async function kalshiPublicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
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
  close_time: string;      // when trading CLOSES (15 min after open) — use this for countdown
  expiration_time: string; // when the contract settles (7 days later) — not used for timing
  status: string;
}

// Orderbook_fp prices are returned as [string_price, string_quantity] pairs
// Sorted ascending by price (lowest ask first)
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

  // yes_dollars / no_dollars are [price_string, qty_string][] sorted ascending by price
  // They represent BID levels — the LAST entry is the highest (best) bid for each side
  // YES price (highest YES bid) ≈ probability YES wins
  // NO price (highest NO bid) ≈ probability NO wins
  const yesDollars = ob.orderbook_fp?.yes_dollars ?? [];
  const noDollars = ob.orderbook_fp?.no_dollars ?? [];

  // Take the LAST element (highest bid) — prices are strings like "0.9900"
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

async function runLoop(
  apiKey: string,
  privateKey: crypto.KeyObject,
  tradeSize: number,
  threshold: number,
  windowSeconds: number,
  checkIntervalMs: number,
): Promise<void> {
  let displayRefreshTick = 0;
  const DISPLAY_REFRESH_EVERY = 10; // refresh display price every N ticks

  while (!stopRequested) {
    try {
      state.lastPollAt = new Date().toISOString();
      displayRefreshTick++;

      const markets = await fetchOpenBtc15mMarkets();
      const now = new Date();

      // Use close_time (end of 15-min trading window) for countdown — NOT expiration_time (7 days)
      const withTiming = markets.map((m) => ({
        market: m,
        closeAt: new Date(m.close_time),
        timeLeftSeconds: (new Date(m.close_time).getTime() - now.getTime()) / 1000,
      }));

      // Markets in the trigger window: trading closes within windowSeconds, hasn't been traded
      const inWindow = withTiming
        .filter(
          ({ timeLeftSeconds, market }) =>
            timeLeftSeconds > 0 &&
            timeLeftSeconds < windowSeconds &&
            !state.tradedMarkets.includes(market.ticker),
        )
        .sort((a, b) => a.timeLeftSeconds - b.timeLeftSeconds);

      // Nearest market by close_time (for dashboard display, including those outside the window)
      const nearest = withTiming
        .filter(({ timeLeftSeconds }) => timeLeftSeconds > 0)
        .sort((a, b) => a.timeLeftSeconds - b.timeLeftSeconds)[0];

      if (nearest) {
        let displayYes = state.currentMarket?.ticker === nearest.market.ticker
          ? state.currentMarket.yesPrice
          : null;
        let displayNo = state.currentMarket?.ticker === nearest.market.ticker
          ? state.currentMarket.noPrice
          : null;

        // Refresh display prices every DISPLAY_REFRESH_EVERY ticks (deterministic)
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

      // Check each market in the window
      for (const { market, timeLeftSeconds } of inWindow) {
        if (stopRequested) break;
        const ticker = market.ticker;

        const { yesPrice, noPrice } = await getOrderbookPrices(ticker);

        // Update display if this is the nearest market
        if (state.currentMarket?.ticker === ticker) {
          state.currentMarket = {
            ...state.currentMarket,
            yesPrice,
            noPrice,
          };
        }

        logger.info(
          {
            ticker,
            timeLeftSeconds: Math.round(timeLeftSeconds),
            yesPrice,
            noPrice,
            threshold,
          },
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
          logger.info(
            { ticker, side: tradeSide, price: tradePrice, count: tradeSize },
            "Placing order",
          );

          // Kalshi orders API: side determines which price field to include
          // yes_price / no_price must be in CENTS (integer 1-99)
          const priceInCents = Math.round(tradePrice * 100);
          const orderBody = {
            ticker,
            action: "buy",
            side: tradeSide,
            type: "limit",
            count: tradeSize,
            ...(tradeSide === "yes"
              ? { yes_price: priceInCents }
              : { no_price: priceInCents }),
          };

          const response = await kalshiPost<unknown>(
            "/orders",
            orderBody,
            apiKey,
            privateKey,
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

  // Load RSA private key once at startup
  const privateKey = loadPrivateKey(apiSecret);

  const {
    tradeSize = 10,
    threshold = 0.97,
    windowSeconds = 120,
    checkIntervalMs = 500,
  } = config;

  stopRequested = false;
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.lastError = null;

  logger.info(
    { tradeSize, threshold, windowSeconds, checkIntervalMs },
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
