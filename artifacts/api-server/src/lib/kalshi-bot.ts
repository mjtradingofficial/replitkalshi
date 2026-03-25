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

export interface StopLossTier {
  priceCents: number;
  fraction: number;
}

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
  triggeredTiers: boolean[];
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

export interface RestingOrder {
  ticker: string;
  orderId: string;
  priceInCents: number;
  count: number;
}

export interface BotState {
  status: BotStatus;
  startedAt: string | null;
  currentMarket: MarketInfo | null;
  trades: Trade[];
  tradedMarkets: string[];
  openPositions: Position[];
  restingOrders: RestingOrder[];
  settlements: Settlement[];
  useStopLoss: boolean;
  stopLossTiers: StopLossTier[];
  lastError: string | null;
  lastPollAt: string | null;
  totalTrades: number;
  totalPnlCents: number;
  winCount: number;
  lossCount: number;
}

export const DEFAULT_STOP_LOSS_TIERS: StopLossTier[] = [
  { priceCents: 90, fraction: 0.333 },
  { priceCents: 87, fraction: 0.333 },
  { priceCents: 85, fraction: 1 },
];

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

async function kalshiDelete(
  path: string,
  apiKey: string,
  privateKey: crypto.KeyObject,
): Promise<void> {
  const headers = signRequest("DELETE", path, "", apiKey, privateKey);
  const res = await fetch(`${BASE_URL}${path}`, { method: "DELETE", headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Kalshi DELETE ${path} failed ${res.status}: ${text}`);
  }
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
  restingOrders: [],
  settlements: [],
  useStopLoss: true,
  stopLossTiers: DEFAULT_STOP_LOSS_TIERS,
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
    stopLossTiers: [...state.stopLossTiers],
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

  // Reconstruct open positions from trades that have no settlement yet
  const settledTickers = new Set(settlements.map((s) => s.ticker));
  const buyTrades = trades.filter((t) => t.action === "buy");
  const stopLossTrades = trades.filter((t) => t.action === "stop-loss-sell");

  for (const buy of buyTrades) {
    if (settledTickers.has(buy.ticker)) continue;

    const sellsForTicker = stopLossTrades.filter((t) => t.ticker === buy.ticker);
    const totalSold = sellsForTicker.reduce((s, t) => s + t.count, 0);
    const remaining = Math.max(0, buy.count - totalSold);
    const buyPriceCents = Math.min(99, Math.max(1, Math.floor(buy.price * 100)));
    const stopLossPnlCents = sellsForTicker.reduce((s, t) => {
      const sellPriceCents = Math.floor(t.price * 100);
      return s + (sellPriceCents - buyPriceCents) * t.count;
    }, 0);

    // Mark all tiers as triggered if any stop-loss sells exist (prevents re-firing)
    const numTiers = state.stopLossTiers.length;
    const triggeredTiers = sellsForTicker.length > 0
      ? new Array(numTiers).fill(true)
      : new Array(numTiers).fill(false);

    state.openPositions.push({
      ticker: buy.ticker,
      side: buy.side,
      totalCount: buy.count,
      remaining,
      boughtAt: buy.price,
      triggeredTiers,
      stopLossPnlCents,
    });
  }

  logger.info(
    {
      trades: trades.length,
      settlements: settlements.length,
      reconstructedPositions: state.openPositions.length,
    },
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
  const buyPriceCents = Math.min(99, Math.max(1, Math.floor(pos.boughtAt * 100)));
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
  useStopLoss: boolean,
  stopLossTiers: StopLossTier[],
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

      // --- Cancel expired resting orders so reserved funds are freed ---
      if (state.restingOrders.length > 0) {
        for (const ro of [...state.restingOrders]) {
          const mkt = withTiming.find((w) => w.market.ticker === ro.ticker);
          if (!mkt || mkt.timeLeftSeconds <= 0) {
            // Market expired — cancel the resting order if still open
            try {
              await kalshiDelete(`/portfolio/orders/${ro.orderId}`, apiKey, privateKey);
              logger.info({ ticker: ro.ticker, orderId: ro.orderId }, "Cancelled expired resting order — balance freed");
            } catch (delErr) {
              const msg = delErr instanceof Error ? delErr.message : String(delErr);
              // 404 means already cancelled by Kalshi at expiry — that's fine
              if (!msg.includes("404")) {
                logger.warn({ ticker: ro.ticker, orderId: ro.orderId, err: msg }, "Could not cancel resting order (may already be gone)");
              }
            }
            state.restingOrders = state.restingOrders.filter((r) => r.orderId !== ro.orderId);
          }
        }
      }

      // --- Stop loss monitoring ---
      if (useStopLoss && stopLossTiers.length > 0) {
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
                const buyPriceCents = Math.min(99, Math.max(1, Math.floor(pos.boughtAt * 100)));
                pos.stopLossPnlCents += (sellPriceInCents - buyPriceCents) * count;
                logger.info({ sellTrade, remainingAfter: pos.remaining, stopLossPnlCents: pos.stopLossPnlCents }, `Stop loss ${label} sell placed`);
              } catch (sellErr) {
                const msg = sellErr instanceof Error ? sellErr.message : String(sellErr);
                logger.error({ err: msg, label, count }, `Stop loss ${label} sell failed`);
              }
            };

            for (let i = 0; i < stopLossTiers.length; i++) {
              const tier = stopLossTiers[i];
              const isLastTier = i === stopLossTiers.length - 1;

              if (!pos.triggeredTiers[i] && currentPrice <= tier.priceCents / 100) {
                pos.triggeredTiers[i] = true;
                let toSell: number;
                if (isLastTier) {
                  toSell = pos.remaining;
                } else {
                  toSell = Math.min(
                    Math.max(1, Math.floor(pos.totalCount * tier.fraction)),
                    pos.remaining,
                  );
                }
                if (toSell > 0) {
                  await fireSell(toSell, `T${i + 1}@${tier.priceCents}¢`);
                }
              }
            }

            if (pos.remaining <= 0) {
              state.openPositions = state.openPositions.filter((p) => p.ticker !== pos.ticker);
            }
          } catch {
            // ignore price fetch error for this position tick
          }
        }
      } else {
        // No stop loss — still need to detect expiry
        for (const pos of [...state.openPositions]) {
          const mkt = withTiming.find((w) => w.market.ticker === pos.ticker);
          if (!mkt || mkt.timeLeftSeconds <= 0) {
            state.openPositions = state.openPositions.filter(
              (p) => p.ticker !== pos.ticker,
            );
            logger.info({ ticker: pos.ticker }, "Position expired — fetching settlement result");
            void settlePosition(pos);
          }
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

          const placeOrder = async (count: number) => kalshiPost<{ order?: { fill_count_fp?: string; remaining_count_fp?: string; order_id?: string } }>(
            "/portfolio/orders",
            { ...orderBody, count },
            apiKey,
            privateKey,
          );

          try {
            let response: Awaited<ReturnType<typeof placeOrder>>;
            try {
              response = await placeOrder(contractCount);
            } catch (firstErr) {
              const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
              if (msg.includes("insufficient_balance") && state.restingOrders.length > 0) {
                // Cancel all resting orders to free reserved funds, then recalculate and retry
                logger.warn({ ticker, restingCount: state.restingOrders.length }, "insufficient_balance — cancelling resting orders and retrying");
                for (const ro of [...state.restingOrders]) {
                  try {
                    await kalshiDelete(`/portfolio/orders/${ro.orderId}`, apiKey, privateKey);
                    logger.info({ orderId: ro.orderId, ticker: ro.ticker }, "Cancelled resting order to free balance");
                  } catch (delErr) {
                    const delMsg = delErr instanceof Error ? delErr.message : String(delErr);
                    if (!delMsg.includes("404")) logger.warn({ orderId: ro.orderId, err: delMsg }, "Could not cancel resting order");
                  }
                  state.restingOrders = state.restingOrders.filter((r) => r.orderId !== ro.orderId);
                }
                // Refetch balance after cancellations
                try {
                  const freshBalance = await kalshiAuthGet<{ balance: number }>("/portfolio/balance", apiKey, privateKey);
                  contractCount = Math.max(1, Math.floor(freshBalance.balance / priceInCents));
                  logger.info({ freshBalanceCents: freshBalance.balance, priceInCents, contractCount }, "Recalculated contracts after cancellations");
                } catch { /* keep existing contractCount */ }
                response = await placeOrder(contractCount);
              } else {
                throw firstErr;
              }
            }

            // Determine how many contracts were actually filled immediately
            const fillCountFp = parseFloat(response?.order?.fill_count_fp ?? String(contractCount));
            const filledCount = isNaN(fillCountFp) ? contractCount : Math.floor(fillCountFp);

            // Always mark as traded so we don't retry this market
            state.tradedMarkets.push(ticker);

            if (filledCount === 0) {
              // Order placed but nothing filled yet — resting in the book.
              // Track it so we can cancel it when the market expires and free the reserved balance.
              const orderId = response?.order?.order_id;
              if (orderId) {
                state.restingOrders.push({ ticker, orderId, priceInCents, count: contractCount });
              }
              logger.warn({ ticker, orderId, reservedCents: contractCount * priceInCents }, "Order resting with 0 fills — tracked for cancellation at expiry");
            } else {
              // Use the exact order price (floored cents) — not the raw orderbook price
              const exactBoughtAt = priceInCents / 100;

              const trade: Trade = {
                id: `${ticker}-${tradeSide}-${Date.now()}`,
                ticker,
                side: tradeSide,
                action: "buy",
                price: exactBoughtAt,
                count: filledCount,
                timestamp: new Date().toISOString(),
                response,
              };

              recordTrade(trade);
              state.totalTrades += 1;

              state.openPositions.push({
                ticker,
                side: tradeSide,
                totalCount: filledCount,
                remaining: filledCount,
                boughtAt: exactBoughtAt,
                triggeredTiers: new Array(stopLossTiers.length).fill(false),
                stopLossPnlCents: 0,
              });

              logger.info({ trade, filledCount }, "Order placed and position opened");
            }
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
  useStopLoss?: boolean;
  stopLossTiers?: StopLossTier[];
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
    useStopLoss = true,
    stopLossTiers = DEFAULT_STOP_LOSS_TIERS,
  } = config;

  await initializeFromDb();

  stopRequested = false;
  state.status = "running";
  state.startedAt = new Date().toISOString();
  state.lastError = null;
  state.useStopLoss = useStopLoss;
  state.stopLossTiers = stopLossTiers;

  logger.info(
    { tradeSize, threshold, windowSeconds, checkIntervalMs, useStopLoss, stopLossTiers },
    "Starting Kalshi BTC15M bot (RSA-PSS auth)",
  );

  runLoop(
    apiKey,
    privateKey,
    tradeSize,
    threshold,
    windowSeconds,
    checkIntervalMs,
    useStopLoss,
    stopLossTiers,
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
