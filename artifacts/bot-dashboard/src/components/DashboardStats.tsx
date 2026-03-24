import React from "react";
import { Layers, Crosshair, Zap, TrendingUp, Target } from "lucide-react";
import { useGetBotStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

function formatPnl(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars >= 0 ? "+" : "";
  return `${sign}$${Math.abs(dollars).toFixed(2)}`;
}

export function DashboardStats() {
  const { data } = useGetBotStatus({
    query: { refetchInterval: 2000 }
  });

  const totalClosed = (data?.winCount ?? 0) + (data?.lossCount ?? 0);
  const accuracy = data?.accuracy != null ? data.accuracy : null;
  const pnlCents = data?.totalPnlCents ?? 0;
  const pnlPositive = pnlCents >= 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
      <div className="glass-panel rgb-bubble rounded-2xl p-5 flex items-center gap-4 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Total Executions</p>
          <p className="text-2xl font-mono font-bold text-foreground">{data?.totalTrades ?? 0}</p>
        </div>
      </div>

      <div className="glass-panel rgb-bubble rounded-2xl p-5 flex items-center gap-4 relative overflow-hidden group" style={{ animationDelay: "0.6s" }}>
        <div className="absolute inset-0 bg-gradient-to-r from-success/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="w-10 h-10 rounded-xl bg-success/10 border border-success/20 flex items-center justify-center shrink-0">
          <Crosshair className="w-5 h-5 text-success" />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Markets Traded</p>
          <p className="text-2xl font-mono font-bold text-foreground">{data?.tradedMarkets?.length ?? 0}</p>
        </div>
      </div>

      <div className="glass-panel rgb-bubble rounded-2xl p-5 flex items-center gap-4 relative overflow-hidden group col-span-2 md:col-span-1" style={{ animationDelay: "1.2s" }}>
        <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          <Layers className="w-5 h-5 text-foreground" />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Strategy</p>
          <p className="text-sm font-mono font-bold text-foreground tracking-tight">BTC 15m SNIPE</p>
        </div>
      </div>

      <div className="glass-panel rgb-bubble rounded-2xl p-5 flex items-center gap-4 relative overflow-hidden group" style={{ animationDelay: "1.8s" }}>
        <div className={cn(
          "absolute inset-0 bg-gradient-to-r to-transparent opacity-0 group-hover:opacity-100 transition-opacity",
          pnlPositive ? "from-success/5" : "from-danger/5"
        )} />
        <div className={cn(
          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border",
          pnlPositive ? "bg-success/10 border-success/20" : "bg-danger/10 border-danger/20"
        )}>
          <TrendingUp className={cn("w-5 h-5", pnlPositive ? "text-success" : "text-danger")} />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Net PnL</p>
          <p className={cn(
            "text-2xl font-mono font-bold",
            pnlPositive ? "text-success" : "text-danger"
          )}>
            {totalClosed === 0 ? "—" : formatPnl(pnlCents)}
          </p>
        </div>
      </div>

      <div className="glass-panel rgb-bubble rounded-2xl p-5 flex items-center gap-4 relative overflow-hidden group" style={{ animationDelay: "2.4s" }}>
        <div className="absolute inset-0 bg-gradient-to-r from-violet/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
          <Target className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">Accuracy</p>
          <p className="text-2xl font-mono font-bold text-foreground">
            {accuracy == null
              ? "—"
              : `${(accuracy * 100).toFixed(0)}%`}
          </p>
          {totalClosed > 0 && (
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {data?.winCount}W / {data?.lossCount}L
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
