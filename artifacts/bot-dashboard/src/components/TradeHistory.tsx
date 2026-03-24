import React from "react";
import { format } from "date-fns";
import { History, ArrowUpRight, ArrowDownRight, ShieldAlert } from "lucide-react";
import { useGetBotTrades } from "@workspace/api-client-react";
import { formatCurrency, cn } from "@/lib/utils";

export function TradeHistory({ noHeader }: { noHeader?: boolean }) {
  const { data, isLoading } = useGetBotTrades({
    query: { refetchInterval: 3000 }
  });

  const trades = data?.trades || [];

  return (
    <div className="glass-panel rounded-tl-none rounded-tr-none rounded-b-2xl flex flex-col overflow-hidden">
      {!noHeader && (
        <div className="p-6 border-b border-card-border bg-card/50 flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <History className="w-5 h-5 text-primary" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Execution Log</h2>
          <div className="ml-auto flex items-center gap-2 text-xs font-mono text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            LIVE SYNC
          </div>
        </div>
      )}
      {noHeader && (
        <div className="px-5 py-3 border-b border-card-border bg-card/30 flex items-center">
          <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground ml-auto">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-50"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            LIVE SYNC
          </div>
        </div>
      )}
      
      <div className="flex-1 overflow-auto p-0 min-h-[400px]">
        {isLoading ? (
          <div className="h-full w-full flex items-center justify-center p-8">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : trades.length === 0 ? (
          <div className="h-full w-full flex flex-col items-center justify-center p-12 text-muted-foreground">
            <History className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg">No trades executed yet</p>
            <p className="text-sm opacity-60">Awaiting optimal market conditions...</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-black/60 sticky top-0 backdrop-blur-md z-10 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-4 px-6 font-semibold">Timestamp</th>
                <th className="py-4 px-6 font-semibold">Ticker</th>
                <th className="py-4 px-6 font-semibold">Action</th>
                <th className="py-4 px-6 font-semibold">Direction</th>
                <th className="py-4 px-6 font-semibold text-right">Price</th>
                <th className="py-4 px-6 font-semibold text-right">Size</th>
              </tr>
            </thead>
            <tbody className="font-mono text-sm divide-y divide-white/5">
              {trades.map((trade) => {
                const isStopLoss = (trade as any).action === "stop-loss-sell";
                return (
                  <tr key={trade.id} className={cn(
                    "hover:bg-white/[0.02] transition-colors group",
                    isStopLoss && "bg-orange-950/20"
                  )}>
                    <td className="py-4 px-6 text-muted-foreground group-hover:text-foreground transition-colors">
                      {format(new Date(trade.timestamp), "HH:mm:ss.SSS")}
                    </td>
                    <td className="py-4 px-6 text-primary">{trade.ticker}</td>
                    <td className="py-4 px-6">
                      {isStopLoss ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold tracking-widest bg-orange-500/10 text-orange-400 border border-orange-500/20">
                          <ShieldAlert className="w-3 h-3" />
                          STOP LOSS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold tracking-widest bg-primary/10 text-primary border border-primary/20">
                          BUY
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold tracking-widest",
                        trade.side === "yes"
                          ? "bg-success/10 text-success border border-success/20"
                          : "bg-danger/10 text-danger border border-danger/20"
                      )}>
                        {trade.side === "yes" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {trade.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right font-bold">
                      {formatCurrency(trade.price)}
                    </td>
                    <td className="py-4 px-6 text-right text-muted-foreground">
                      {trade.count}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
