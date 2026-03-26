import React from "react";
import { Target, Timer, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { useGetBotStatus } from "@workspace/api-client-react";
import { formatCurrency, formatTimeLeft, cn } from "@/lib/utils";

const EMA_THRESHOLD = 0.88;

function MomentumBar({ ema, active }: { ema: number | null | undefined; active: boolean }) {
  const pct = ema != null ? Math.min(100, Math.round(ema * 100)) : 0;
  const ready = ema != null && ema >= EMA_THRESHOLD;
  return (
    <div className="w-full mt-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
          <Activity className="w-3 h-3" /> Momentum EMA
        </span>
        <span className={cn(
          "text-[10px] font-mono font-bold",
          ready ? (active ? "text-success" : "text-primary") : "text-muted-foreground"
        )}>
          {ema != null ? `${pct}¢` : "—"}
          {ready && " ✓"}
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            ready
              ? active ? "bg-success shadow-[0_0_6px_rgba(34,197,94,0.6)]" : "bg-primary shadow-[0_0_6px_rgba(0,240,255,0.4)]"
              : "bg-white/25"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        className="relative w-full"
        title={`Entry fires when EMA ≥ ${Math.round(EMA_THRESHOLD * 100)}¢`}
      >
        <div
          className="absolute top-0 h-2 w-px bg-yellow-400/60"
          style={{ left: `${Math.round(EMA_THRESHOLD * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function MarketCard() {
  const { data: statusData } = useGetBotStatus({
    query: { refetchInterval: 1000 }
  });

  const market = statusData?.currentMarket;
  
  if (!market) {
    return (
      <div className="glass-panel rounded-2xl p-6 flex flex-col items-center justify-center min-h-[300px] text-center border-dashed border-2 border-white/10">
        <Target className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
        <h3 className="text-lg font-semibold text-foreground mb-2">No Active Target</h3>
        <p className="text-sm text-muted-foreground max-w-[200px]">
          Searching Kalshi orderbook for eligible BTC 15-min contracts...
        </p>
      </div>
    );
  }

  const isWindowActive = market.timeLeftSeconds < 120;
  const highlightYes = market.yesPrice !== null && market.yesPrice >= 0.97;
  const highlightNo = market.noPrice !== null && market.noPrice >= 0.97;
  const yesEmaReady = (market as { yesEma?: number }).yesEma != null && (market as { yesEma?: number }).yesEma! >= EMA_THRESHOLD;
  const noEmaReady = (market as { noEma?: number }).noEma != null && (market as { noEma?: number }).noEma! >= EMA_THRESHOLD;

  return (
    <div className={cn(
      "glass-panel rounded-2xl p-6 relative overflow-hidden transition-all duration-500",
      isWindowActive ? "border-primary/50 shadow-[0_0_30px_-5px_rgba(0,240,255,0.15)]" : ""
    )}>
      {isWindowActive && (
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent animate-pulse" />
      )}
      
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Active Contract</h2>
          <div className="text-xl font-mono font-bold text-primary text-shadow-glow-primary">
            {market.ticker}
          </div>
        </div>
        
        <div className="text-right">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center justify-end gap-1">
            <Timer className="w-4 h-4" /> T-Minus
          </h2>
          <div className={cn(
            "text-3xl font-mono font-bold tabular-nums tracking-tighter",
            isWindowActive ? "text-primary text-shadow-glow-primary" : "text-foreground"
          )}>
            {formatTimeLeft(market.timeLeftSeconds)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* YES Side */}
        <div className={cn(
          "rounded-xl p-5 border flex flex-col items-center justify-center transition-all duration-300",
          highlightYes && yesEmaReady
            ? "bg-success/10 border-success box-shadow-glow-success"
            : highlightYes
            ? "bg-yellow-400/5 border-yellow-400/30"
            : "bg-black/40 border-white/5"
        )}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className={cn("w-5 h-5", highlightYes ? (yesEmaReady ? "text-success" : "text-yellow-400") : "text-muted-foreground")} />
            <span className={cn("font-bold tracking-widest", highlightYes ? (yesEmaReady ? "text-success" : "text-yellow-400") : "text-muted-foreground")}>YES</span>
          </div>
          <div className={cn(
            "text-3xl font-mono font-bold",
            highlightYes && yesEmaReady ? "text-success text-shadow-glow-success" : highlightYes ? "text-yellow-400" : "text-foreground"
          )}>
            {formatCurrency(market.yesPrice)}
          </div>
          <MomentumBar ema={(market as { yesEma?: number }).yesEma} active={highlightYes} />
        </div>

        {/* NO Side */}
        <div className={cn(
          "rounded-xl p-5 border flex flex-col items-center justify-center transition-all duration-300",
          highlightNo && noEmaReady
            ? "bg-danger/10 border-danger box-shadow-glow-danger"
            : highlightNo
            ? "bg-yellow-400/5 border-yellow-400/30"
            : "bg-black/40 border-white/5"
        )}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className={cn("w-5 h-5", highlightNo ? (noEmaReady ? "text-danger" : "text-yellow-400") : "text-muted-foreground")} />
            <span className={cn("font-bold tracking-widest", highlightNo ? (noEmaReady ? "text-danger" : "text-yellow-400") : "text-muted-foreground")}>NO</span>
          </div>
          <div className={cn(
            "text-3xl font-mono font-bold",
            highlightNo && noEmaReady ? "text-danger text-shadow-glow-danger" : highlightNo ? "text-yellow-400" : "text-foreground"
          )}>
            {formatCurrency(market.noPrice)}
          </div>
          <MomentumBar ema={(market as { noEma?: number }).noEma} active={highlightNo} />
        </div>
      </div>

      {(highlightYes || highlightNo) && !(yesEmaReady || noEmaReady) && (
        <p className="text-center text-xs text-yellow-400/70 mt-3 font-medium">
          Price above threshold — waiting for EMA to confirm momentum...
        </p>
      )}
    </div>
  );
}
