import React, { useState } from "react";
import { Activity, Power, Square, AlertTriangle, Play, Settings2 } from "lucide-react";
import { useGetBotStatus, useStartBot, useStopBot } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Modal } from "./ui/Modal";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

export function StatusCard() {
  const queryClient = useQueryClient();
  const { data: statusData, isLoading } = useGetBotStatus({
    query: { refetchInterval: 1000 }
  });
  
  const startMutation = useStartBot({
    mutation: {
      onSuccess: () => {
        setIsConfigOpen(false);
        queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] });
      }
    }
  });
  
  const stopMutation = useStopBot({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] });
      }
    }
  });

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [config, setConfig] = useState({
    tradeSize: 10,
    thresholdCents: 97,
    windowSeconds: 180,
    checkIntervalMs: 500,
    stopLossPrice: 0.80,
  });

  const isRunning = statusData?.status === "running";
  const isError = statusData?.status === "error";

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    startMutation.mutate({
      data: {
        tradeSize: config.tradeSize,
        thresholdCents: config.thresholdCents,
        windowSeconds: config.windowSeconds,
        checkIntervalMs: config.checkIntervalMs,
        stopLossPrice: config.stopLossPrice,
      }
    });
  };

  return (
    <>
      <div className="glass-panel rounded-2xl p-6 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-32 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none group-hover:bg-primary/10 transition-colors duration-500" />
        
        <div className="flex justify-between items-start mb-8 relative z-10">
          <div>
            <h2 className="text-lg font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-2">
              <Activity className="w-4 h-4" /> System Status
            </h2>
            <div className="flex items-center gap-3">
              <div className="relative flex h-4 w-4">
                {isRunning && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                )}
                <span className={cn(
                  "relative inline-flex rounded-full h-4 w-4",
                  isRunning ? "bg-success" : isError ? "bg-danger" : "bg-muted-foreground"
                )}></span>
              </div>
              <span className={cn(
                "text-2xl font-bold uppercase tracking-widest",
                isRunning ? "text-success text-shadow-glow-success" : isError ? "text-danger text-shadow-glow-danger" : "text-foreground"
              )}>
                {isLoading ? "CONNECTING..." : statusData?.status || "UNKNOWN"}
              </span>
            </div>
          </div>
          
          {isRunning ? (
            <button
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              className="px-4 py-2 rounded-xl bg-danger/10 text-danger border border-danger/20 hover:bg-danger hover:text-white transition-all font-semibold flex items-center gap-2 disabled:opacity-50"
            >
              <Square className="w-4 h-4 fill-current" />
              {stopMutation.isPending ? "HALTING..." : "HALT"}
            </button>
          ) : (
            <button
              onClick={() => setIsConfigOpen(true)}
              className="px-4 py-2 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-primary-foreground transition-all font-semibold flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-current" />
              INITIALIZE
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 relative z-10">
          <div className="bg-black/40 rounded-xl p-4 border border-white/5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Started At</p>
            <p className="font-mono text-sm">
              {statusData?.startedAt ? format(new Date(statusData.startedAt), "HH:mm:ss.SSS") : "---"}
            </p>
          </div>
          <div className="bg-black/40 rounded-xl p-4 border border-white/5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Last Sync</p>
            <p className="font-mono text-sm">
              {statusData?.lastPollAt ? format(new Date(statusData.lastPollAt), "HH:mm:ss.SSS") : "---"}
            </p>
          </div>
        </div>

        {statusData?.lastError && (
          <div className="mt-4 bg-danger/10 border border-danger/20 rounded-xl p-4 flex items-start gap-3 text-danger relative z-10">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm font-mono break-all">{statusData.lastError}</div>
          </div>
        )}
      </div>

      <Modal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} title="Initialize Bot">
        <form onSubmit={handleStart} className="space-y-5">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                <Settings2 className="w-4 h-4" /> Trade Size (Contracts)
              </label>
              <input
                type="number"
                value={config.tradeSize}
                onChange={e => setConfig({ ...config, tradeSize: parseInt(e.target.value) || 0 })}
                className="w-full bg-black/50 border border-card-border rounded-xl px-4 py-3 font-mono text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                min="1"
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                Target Threshold (Cents)
              </label>
              <input
                type="number"
                value={config.thresholdCents}
                onChange={e => setConfig({ ...config, thresholdCents: parseInt(e.target.value) || 0 })}
                className="w-full bg-black/50 border border-card-border rounded-xl px-4 py-3 font-mono text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                min="1"
                max="100"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                Action Window (Seconds)
              </label>
              <input
                type="number"
                value={config.windowSeconds}
                onChange={e => setConfig({ ...config, windowSeconds: parseInt(e.target.value) || 0 })}
                className="w-full bg-black/50 border border-card-border rounded-xl px-4 py-3 font-mono text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                min="1"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                Stop Loss Price ($)
              </label>
              <input
                type="number"
                value={config.stopLossPrice}
                onChange={e => setConfig({ ...config, stopLossPrice: parseFloat(e.target.value) || 0 })}
                className="w-full bg-black/50 border border-orange-500/30 rounded-xl px-4 py-3 font-mono text-foreground focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 transition-all"
                min="0.01"
                max="0.99"
                step="0.01"
              />
              <p className="text-xs text-muted-foreground mt-1">Sell all contracts if price drops to this level</p>
            </div>
          </div>

          <div className="pt-4 border-t border-card-border">
            <button
              type="submit"
              disabled={startMutation.isPending}
              className="w-full py-4 rounded-xl bg-primary text-primary-foreground font-bold tracking-widest hover:bg-primary/90 hover:shadow-[0_0_20px_rgba(0,240,255,0.3)] transition-all flex justify-center items-center gap-2 disabled:opacity-50"
            >
              {startMutation.isPending ? "CONNECTING TO EXCHANGE..." : "COMMENCE TRADING"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
