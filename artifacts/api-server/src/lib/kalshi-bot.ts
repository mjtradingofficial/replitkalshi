import crypto from "crypto";
import { logger } from "./logger";
import { getPool } from "./db";

const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

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
  totalCount: number;
  remaining: number;
  boughtAt: number;
  tier1Triggered: boolean;
  tier2Triggered: boolean;
  stopLossPnlCents: number;
}

export interface Settlement {
  ticker: string;
  side: "yes" | "no";
  result: "yes" | "no";
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
  settlements: Settlement[];
  stopLossPrice: number;
  lastError: string | null;
  lastPollAt: string | null;
  totalTrades: number;
  totalPnlCents: number;
  winCount: number;
  lossCount: number;
}

// --- Database persistence ---

async function dbLoadTrades(): Promise<Trade[]> {
  try {
    const pool = getPool();
    const res = await pool.query<{
      id: string; ticker: string; side: string; action: string;
      price: number; count: number; timestamp: string; response: unknown;
    }>(
      "SELECT id, ticker, side, action, price, count, timestamp, response FROM trades ORDER BY timestamp DESC"
    );
    return res.rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      side: r.side as "yes" | "no",
      action: r.action as TradeAction,
      price: Number(r.price),
      count: Number(r.count),
      timestamp: new Date(r.timestamp).toISOString(),
      response: r.response,
    }));
  } catch (err) {
    logger.warn({ err }, "Failed to load trades from DB");
    return [];
  }
}

async function dbSaveTrade(trade: Trade): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO trades (id, ticker, side, action, price, count, timestamp, response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [trade.id, trade.ticker, trade.side, trade.action, trade.price, trade.count, trade.timestamp, trade.response]
    );
  } catch (err) {
    logger.warn({ err }, "Failed to save trade to DB");
  }
}

async function dbLoadSettlements(): Promise<Settlement[]> {
  try {
    const pool = getPool();
    const res = await pool.query(
      `SELECT ticker, side, result, won, buy_price_cents, total_bought, sold_via_stop_loss,
              settled_count, stop_loss_pnl_cents, settlement_pnl_cents, total_pnl_cents, settled_at
       FROM settlements ORDER BY settled_at DESC`
    );
    return res.rows.map((r) => ({
      ticker: r.ticker,
      side: r.side as "yes" | "no",
      result: r.result as "yes" | "no",
      won: r.won,
      buyPriceCents: Number(r.buy_price_cents),
      totalBought: Number(r.total_bought),
      soldViaStopLoss: Number(r.sold_via_stop_loss),
      settledCount: Number(r.settled_count),
      stopLossPnlCents: Number(r.stop_loss_pnl_cents),
      settlementPnlCents: Number(r.settlement_pnl_cents),
      totalPnlCents: Number(r.total_pnl_cents),
      settledAt: new Date(r.settled_at).toISOString(),
    }));
  } catch (err) {
    logger.warn({ err }, "Failed to load settlements from DB");
    return [];
  }
}

async function dbSaveSettlement(s: Settlement): Promise<void> {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO settlements (ticker, side, result, won, buy_price_cents, total_bought, sold_via_stop_loss,
        settled_count, stop_loss_pnl_cents, settlement_pnl_cents, total_pnl_cents, settled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (ticker) DO UPDATE SET
         result = EXCLUDED.result, won = EXCLUDED.won, total_pnl_cents = EXCLUDED.total_pnl_cents,
         settlement_pnl_cents = EXCLUDED.settlement_pnl_cents, settled_at = EXCLUDED.settled_at`,
      [s.ticker, s.side, s.result, s.won, s.buyPriceCents, s.totalBought, s.soldViaStopLoss,
       s.settledCount, s.stopLossPnlCents, s.settlementPnlCents, s.totalPnlCents, s.settledAt]
    );
  } catch (err) {
    logger.warn({ err }, "Failed to save settlement to DB");
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
  trades: [],
  tradedMarkets: [],
  openPositions: [],
  settlements: [],
  stopLossPrice: 0.80,
  lastError: null,
  lastPollAt: null,
  totalTrades: 0,
  totalPnlCents: 0,
  winCount: 0,
  lossCount: 0,
};

let stopRequested = false;

export function getBotState(): BotState {
  return {
    ...state,
    trades: [...state.trades],
    openPositions: [...state.openPositions],
    settlements: [...state.settlements],
  };
}

async function initializeFromDb(): Promise<void> {
  const [trades, settlements] = await Promise.all([
    dbLoadTrades(),
    dbLoadSettlements(),
  ]);

  state.trades = trades;
  state.settlements = settlements;
  state.tradedMarkets = [
    ...new Set(
      trades.filter((t) => t.action === "buy").map((t) => t.ticker),
    ),
  ];
  state.totalTrades = trades.length;
  state.totalPnlCents = settlements.reduce((s, x) => s + x.totalPnlCents, 0);
  state.winCount = settlements.filter((x) => x.won).length;
  state.lossCount = settlements.filter((x) => !x.won).length;

  logger.info(
    { trades: trades.length, settlements: settlements.length },
    "Loaded state from database",
  );
}

async function fetchMarketResult(
  ticker: string,
): Promise<"yes" | "no" | null> {
  const data = await kalshiPublicGet<{ market: { result: string | null } }>(
    `/markets/${ticker}`,
  );
  const r = data?.market?.result;
  if (r === "yes" || r === "no") return r;
  return null;
}

async function settlePosition(pos: Position): Promise<void> {
  let result: "yes" | "no" | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      result = await fetchMarketResult(pos.ticker);
      if (result) break;
    } catch (err) {
      logger.warn({ err, attempt }, "Failed to fetch market result, retrying");
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!result) {
    logger.warn({ ticker: pos.ticker }, "Could not determine market result after retries");
    return;
  }

  const won = result === pos.side;
  const buyPriceCents = Math.round(pos.boughtAt * 100);
  const soldViaStopLoss = pos.totalCount - pos.remaining;
  const settledCount = pos.remaining;

  const settlementPnlCents = won
    ? (100 - buyPriceCents) * settledCount
    : -buyPriceCents * settledCount;

  const totalPnlCents = pos.stopLossPnlCents + settlementPnlCents;

  const settlement: Settlement = {
    ticker: pos.ticker,
    side: pos.side,
    result,
    won,
    buyPriceCents,
    totalBought: pos.totalCount,
    soldViaStopLoss,
    settledCount,
    stopLossPnlCents: pos.stopLossPnlCents,
    settlementPnlCents,
    totalPnlCents,
    settledAt: new Date().toISOString(),
  };

  state.settlements.unshift(settlement);
  state.totalPnlCents += totalPnlCents;
  if (won) state.winCount += 1;
  else state.lossCount += 1;

  void dbSaveSettlement(settlement);

  logger.info(
    { ticker: pos.ticker, result, won, totalPnlCents, settlementPnlCents, stopLossPnlCents: pos.stopLossPnlCents },
    "Position settled",
  );
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
  void dbSaveTrade(trade);
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

      // --- Tiered stop loss: 1/3 at 90c, 1/3 at 87c, all remaining at 85c ---
      for (const pos of [...state.openPositions]) {
        const mkt = withTiming.find((w) => w.market.ticker === pos.ticker);

        if (!mkt || mkt.timeLeftSeconds <= 0) {
          state.openPositions = state.openPositions.filter(
            (p) => p.ticker !== pos.ticker,
          );
          logger.info({ ticker: pos.ticker }, "Position expired — fetching settlement result");
          void settlePosition(pos);
          continue;
        }

        if (pos.remaining <= 0) continue;

        try {
          const { yesPrice, noPrice } = await getOrderbookPrices(pos.ticker);
          const currentPrice = pos.side === "yes" ? yesPrice : noPrice;
          if (currentPrice === null) continue;

          const fireSell = async (count: number, label: string) => {
            const sellPriceInCents = Math.max(1, Math.floor(currentPrice * 100));
            logger.warn(
              { ticker: pos.ticker, side: pos.side, currentPrice, count, label },
              `Stop loss ${label} triggered`,
            );
            const sellBody = {
              ticker: pos.ticker,
              action: "sell",
              side: pos.side,
              type: "limit",
              count,
              ...(pos.side === "yes"
                ? { yes_price: sellPriceInCents }
                : { no_price: sellPriceInCents }),
            };
            try {
              const response = await kalshiPost<unknown>("/portfolio/orders", sellBody, apiKey, privateKey);
              const sellTrade: Trade = {
                id: `${pos.ticker}-${pos.side}-sell-${Date.now()}`,
                ticker: pos.ticker,
                side: pos.side,
                action: "stop-loss-sell",
                price: currentPrice,
                count,
                timestamp: new Date().toISOString(),
                response,
              };
              recordTrade(sellTrade);
              state.totalTrades += 1;
              pos.remaining -= count;
              const buyPriceCents = Math.round(pos.boughtAt * 100);
              pos.stopLossPnlCents += (sellPriceInCents - buyPriceCents) * count;
              logger.info({ sellTrade, remainingAfter: pos.remaining, stopLossPnlCents: pos.stopLossPnlCents }, `Stop loss ${label} sell placed`);
            } catch (sellErr) {
              const msg = sellErr instanceof Error ? sellErr.message : String(sellErr);
              logger.error({ err: msg, label, count }, `Stop loss ${label} sell failed`);
            }
          };

          if (!pos.tier1Triggered && currentPrice <= 0.90) {
            pos.tier1Triggered = true;
            const toSell = Math.max(1, Math.floor(pos.totalCount / 3));
            await fireSell(Math.min(toSell, pos.remaining), "T1@0.90");
          }

          if (!pos.tier2Triggered && currentPrice <= 0.87) {
            pos.tier2Triggered = true;
            const toSell = Math.max(1, Math.floor(pos.totalCount / 3));
            await fireSell(Math.min(toSell, pos.remaining), "T2@0.87");
          }

          if (pos.tier1Triggered && pos.tier2Triggered && currentPrice <= 0.85 && pos.remaining > 0) {
            await fireSell(pos.remaining, "T3@0.85");
          }

          if (pos.remaining <= 0) {
            state.openPositions = state.openPositions.filter((p) => p.ticker !== pos.ticker);
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

        if (state.tradedMarkets.includes(ticker)) continue;

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

            state.openPositions.push({
              ticker,
              side: tradeSide,
              totalCount: contractCount,
              remaining: contractCount,
              boughtAt: tradePrice,
              tier1Triggered: false,
              tier2Triggered: false,
              stopLossPnlCents: 0,
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

export async function startBot(config: BotConfig = {}): Promise<void> {
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

  // Load all historical data from DB before starting
  await initializeFromDb();

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
