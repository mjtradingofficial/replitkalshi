import { Router, type IRouter } from "express";
import crypto from "crypto";

const router: IRouter = Router();

const BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";

function signRequest(
  method: string,
  path: string,
  body: string,
): Record<string, string> {
  const apiKey = process.env.KALSHI_API_KEY ?? "";
  const apiSecret = process.env.KALSHI_API_SECRET ?? "";
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

async function kalshiGet(path: string) {
  const headers = signRequest("GET", path, "");
  const r = await fetch(`${BASE_URL}${path}`, { headers });
  const data = await r.json();
  return { status: r.status, data };
}

router.get("/debug/markets-raw", async (_req, res) => {
  const result = await kalshiGet("/markets?limit=20&status=open");
  res.json(result);
});

router.get("/debug/btc-series", async (_req, res) => {
  const results: Record<string, unknown> = {};
  for (const st of ["KXBTC", "BTC", "KXCRYPTO", "KXETH"]) {
    const r = await kalshiGet(`/series/${st}`);
    results[st] = r;
  }
  res.json(results);
});

router.get("/debug/btc-events", async (_req, res) => {
  const result = await kalshiGet("/events?series_ticker=KXBTC&limit=5");
  res.json(result);
});

router.get("/debug/series-list", async (_req, res) => {
  const result = await kalshiGet("/series?limit=50");
  res.json(result);
});

router.get("/debug/orderbook/:ticker", async (req, res) => {
  const { ticker } = req.params;
  const result = await kalshiGet(`/markets/${ticker}/orderbook`);
  res.json(result);
});

export default router;
