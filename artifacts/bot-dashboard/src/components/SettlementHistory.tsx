import React from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trophy, CheckCircle2, XCircle, TrendingUp, TrendingDown } from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import type { Settlement } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface SettlementList {
  settlements: Settlement[];
}

function useFetchSettlements() {
  return useQuery<SettlementList>({
    queryKey: ["/api/bot/settlements"],
    queryFn: () => customFetch<SettlementList>("/api/bot/settlements"),
    refetchInterval: 5000,
  });
}

function formatCents(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars >= 0 ? "+" : "";
  return `${sign}$${Math.abs(dollars).toFixed(2)}`;
}

export function SettlementHistory({ noHeader }: { noHeader?: boolean }) {
  const { data, isLoading } = useFetchSettlements();
  const settlements = data?.settlements ?? [];

  return (
    <div className="glass-panel rounded-tl-none rounded-tr-none rounded-b-2xl overflow-hidden">
      {!noHeader && (
        <div className="p-6 border-b border-card-border bg-card/50 flex items-center gap-3">
          <div className="p-2 bg-violet-500/10 rounded-lg">
            <Trophy className="w-5 h-5 text-violet-400" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Settlement Results</h2>
          <span className="ml-auto text-xs font-mono text-muted-foreground">
            {settlements.length} closed position{settlements.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      {noHeader && (
        <div className="px-5 py-3 border-b border-card-border bg-card/30 flex items-center">
          <span className="text-xs font-mono text-muted-foreground ml-auto">
            {settlements.length} closed position{settlements.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div className="overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="w-6 h-6 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : settlements.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 text-muted-foreground">
            <Trophy className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">No settled positions yet</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-black/60 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-3 px-5 font-semibold">Time</th>
                <th className="py-3 px-5 font-semibold">Ticker</th>
                <th className="py-3 px-5 font-semibold">Side</th>
                <th className="py-3 px-5 font-semibold text-right">Bought At</th>
                <th className="py-3 px-5 font-semibold">Result</th>
                <th className="py-3 px-5 font-semibold">Outcome</th>
                <th className="py-3 px-5 font-semibold text-right">Contracts</th>
                <th className="py-3 px-5 font-semibold text-right">Stop Loss PnL</th>
                <th className="py-3 px-5 font-semibold text-right">Settlement PnL</th>
                <th className="py-3 px-5 font-semibold text-right">Total PnL</th>
              </tr>
            </thead>
            <tbody className="font-mono text-sm divide-y divide-white/5">
              {settlements.map((s, i) => (
                <tr key={i} className={cn(
                  "hover:bg-white/[0.02] transition-colors",
                  s.won ? "bg-success/[0.03]" : "bg-danger/[0.03]"
                )}>
                  <td className="py-3 px-5 text-muted-foreground text-xs">
                    {format(new Date(s.settledAt), "HH:mm:ss")}
                  </td>
                  <td className="py-3 px-5 text-primary text-xs">{s.ticker}</td>
                  <td className="py-3 px-5">
                    <span className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded text-xs font-bold tracking-widest border",
                      s.side === "yes"
                        ? "bg-success/10 text-success border-success/20"
                        : "bg-danger/10 text-danger border-danger/20"
                    )}>
                      {s.side.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 px-5 text-right text-xs font-bold text-primary">
                    {s.buyPriceCents}¢
                  </td>
                  <td className="py-3 px-5">
                    <span className="text-xs text-muted-foreground">
                      Resolved <span className={cn("font-bold", s.result === "yes" ? "text-success" : "text-danger")}>
                        {s.result.toUpperCase()}
                      </span>
                    </span>
                  </td>
                  <td className="py-3 px-5">
                    {s.won ? (
                      <span className="inline-flex items-center gap-1.5 text-success text-xs font-bold">
                        <CheckCircle2 className="w-4 h-4" /> WIN
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-danger text-xs font-bold">
                        <XCircle className="w-4 h-4" /> LOSS
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-5 text-right text-xs text-muted-foreground">
                    {s.totalBought}
                    {s.soldViaStopLoss > 0 && (
                      <span className="text-orange-400 ml-1">(-{s.soldViaStopLoss} SL)</span>
                    )}
                  </td>
                  <td className={cn(
                    "py-3 px-5 text-right text-xs font-semibold",
                    s.stopLossPnlCents >= 0 ? "text-success" : "text-orange-400"
                  )}>
                    {s.soldViaStopLoss > 0 ? formatCents(s.stopLossPnlCents) : "—"}
                  </td>
                  <td className={cn(
                    "py-3 px-5 text-right text-xs font-semibold",
                    s.settlementPnlCents >= 0 ? "text-success" : "text-danger"
                  )}>
                    {s.settledCount > 0 ? formatCents(s.settlementPnlCents) : "—"}
                  </td>
                  <td className={cn(
                    "py-3 px-5 text-right font-bold",
                    s.totalPnlCents >= 0 ? "text-success" : "text-danger"
                  )}>
                    <span className="flex items-center justify-end gap-1">
                      {s.totalPnlCents >= 0
                        ? <TrendingUp className="w-3.5 h-3.5" />
                        : <TrendingDown className="w-3.5 h-3.5" />}
                      {formatCents(s.totalPnlCents)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
