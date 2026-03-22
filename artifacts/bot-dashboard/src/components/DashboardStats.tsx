import React from "react";
import { Layers, Crosshair, Zap } from "lucide-react";
import { useGetBotStatus } from "@workspace/api-client-react";

export function DashboardStats() {
  const { data } = useGetBotStatus({
    query: { refetchInterval: 5000 }
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <div className="glass-panel rounded-2xl p-5 flex items-center gap-5 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Zap className="w-6 h-6 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Total Executions</p>
          <p className="text-2xl font-mono font-bold text-foreground">{data?.totalTrades || 0}</p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-5 flex items-center gap-5 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-r from-success/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="w-12 h-12 rounded-xl bg-success/10 border border-success/20 flex items-center justify-center shrink-0">
          <Crosshair className="w-6 h-6 text-success" />
        </div>
        <div>
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Markets Traded</p>
          <p className="text-2xl font-mono font-bold text-foreground">{data?.tradedMarkets?.length || 0}</p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-5 flex items-center gap-5 relative overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
          <Layers className="w-6 h-6 text-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Strategy</p>
          <p className="text-lg font-mono font-bold text-foreground tracking-tight">BTC 15m SNIPE</p>
        </div>
      </div>
    </div>
  );
}
