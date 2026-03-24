import React from "react";
import { Target, Timer, TrendingUp, TrendingDown } from "lucide-react";
import { useGetBotStatus } from "@workspace/api-client-react";
import { formatCurrency, formatTimeLeft, cn } from "@/lib/utils";

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
          highlightYes 
            ? "bg-success/10 border-success box-shadow-glow-success" 
            : "bg-black/40 border-white/5"
        )}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className={cn("w-5 h-5", highlightYes ? "text-success" : "text-muted-foreground")} />
            <span className={cn("font-bold tracking-widest", highlightYes ? "text-success" : "text-muted-foreground")}>YES</span>
          </div>
          <div className={cn(
            "text-3xl font-mono font-bold",
            highlightYes ? "text-success text-shadow-glow-success" : "text-foreground"
          )}>
            {formatCurrency(market.yesPrice)}
          </div>
        </div>

        {/* NO Side */}
        <div className={cn(
          "rounded-xl p-5 border flex flex-col items-center justify-center transition-all duration-300",
          highlightNo 
            ? "bg-danger/10 border-danger box-shadow-glow-danger" 
            : "bg-black/40 border-white/5"
        )}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className={cn("w-5 h-5", highlightNo ? "text-danger" : "text-muted-foreground")} />
            <span className={cn("font-bold tracking-widest", highlightNo ? "text-danger" : "text-muted-foreground")}>NO</span>
          </div>
          <div className={cn(
            "text-3xl font-mono font-bold",
            highlightNo ? "text-danger text-shadow-glow-danger" : "text-foreground"
          )}>
            {formatCurrency(market.noPrice)}
          </div>
        </div>
      </div>
    </div>
  );
}
