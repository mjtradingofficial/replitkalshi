import React, { useState } from "react";
import {
  Activity, Square, AlertTriangle, Play, Plus, Trash2, Info, ShieldOff, Shield, Wallet, Hash, TrendingDown, ArrowDownUp, TrendingUp,
} from "lucide-react";
import { useGetBotStatus, useStartBot, useStopBot } from "@workspace/api-client-react";
import type { StopLossTier } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Modal } from "./ui/Modal";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

const DEFAULT_TIERS: StopLossTier[] = [
  { priceCents: 90, fraction: 0.333 },
  { priceCents: 87, fraction: 0.333 },
  { priceCents: 85, fraction: 1 },
];

function Hint({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex">
      <Info
        className="w-3.5 h-3.5 text-muted-foreground cursor-pointer hover:text-primary transition-colors"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      />
      {show && (
        <span className="absolute left-5 top-0 z-50 w-56 bg-black border border-card-border rounded-lg p-2 text-xs text-muted-foreground shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground mb-2">
      {children}
    </label>
  );
}

function Toggle({ value, onChange, color = "primary" }: { value: boolean; onChange: (v: boolean) => void; color?: "primary" | "orange" }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={cn(
        "relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0",
        value
          ? color === "orange" ? "bg-orange-500" : "bg-primary"
          : "bg-white/10",
      )}
    >
      <span
        className={cn(
          "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200",
          value ? "translate-x-7" : "translate-x-1",
        )}
      />
    </button>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const v = step && step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
      className={cn(
        "w-full bg-black/50 border border-card-border rounded-xl px-3 py-2.5 font-mono text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all",
        className,
      )}
      min={min}
      max={max}
      step={step}
    />
  );
}

function SectionHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-xs uppercase tracking-widest font-bold mb-4 flex items-center gap-2", className)}>
      {children}
    </p>
  );
}

export function StatusCard() {
  const queryClient = useQueryClient();
  const { data: statusData, isLoading } = useGetBotStatus({
    query: { refetchInterval: 1000 },
  });

  const startMutation = useStartBot({
    mutation: {
      onSuccess: () => {
        setIsConfigOpen(false);
        queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] });
      },
    },
  });

  const stopMutation = useStopBot({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] });
      },
    },
  });

  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // Entry
  const [thresholdCents, setThresholdCents] = useState(97);
  const [maxTriggerPriceCents, setMaxTriggerPriceCents] = useState(97);
  const [maxEntryPriceCents, setMaxEntryPriceCents] = useState(99);
  const [windowSeconds, setWindowSeconds] = useState(180);
  const [minTimeLeftSeconds, setMinTimeLeftSeconds] = useState(30);
  const [checkIntervalMs, setCheckIntervalMs] = useState(500);

  // Momentum (EMA)
  const [useEma, setUseEma] = useState(false);
  const [emaAlpha, setEmaAlpha] = useState(0.2);
  const [emaThreshold, setEmaThreshold] = useState(88);

  // Position
  const [useAllBalance, setUseAllBalance] = useState(false);
  const [tradeSize, setTradeSize] = useState(10);

  // Stop loss
  const [useStopLoss, setUseStopLoss] = useState(true);
  const [useTrailingStop, setUseTrailingStop] = useState(false);
  const [trailingStopCents, setTrailingStopCents] = useState(5);
  const [tiers, setTiers] = useState<StopLossTier[]>(DEFAULT_TIERS);

  const isRunning = statusData?.status === "running";
  const isError = statusData?.status === "error";

  const updateTier = (i: number, field: keyof StopLossTier, val: number) => {
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: val } : t)));
  };

  const addTier = () => {
    if (tiers.length >= 5) return;
    const lastPrice = tiers[tiers.length - 1]?.priceCents ?? 85;
    setTiers((prev) => [...prev, { priceCents: Math.max(1, lastPrice - 2), fraction: 0.333 }]);
  };

  const removeTier = (i: number) => {
    if (tiers.length <= 1) return;
    setTiers((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    startMutation.mutate({
      data: {
        thresholdCents,
        maxTriggerPriceCents,
        maxEntryPriceCents,
        windowSeconds,
        checkIntervalMs,
        minTimeLeftSeconds,
        emaAlpha,
        emaThreshold: useEma ? emaThreshold / 100 : 0,
        useAllBalance,
        tradeSize: useAllBalance ? undefined : tradeSize,
        useStopLoss,
        useTrailingStop,
        trailingStopCents: useTrailingStop ? trailingStopCents : undefined,
        stopLossTiers: useTrailingStop ? [] : tiers,
      },
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
                <span
                  className={cn(
                    "relative inline-flex rounded-full h-4 w-4",
                    isRunning ? "bg-success" : isError ? "bg-danger" : "bg-muted-foreground",
                  )}
                />
              </div>
              <span
                className={cn(
                  "text-2xl font-bold uppercase tracking-widest",
                  isRunning ? "text-success text-shadow-glow-success" : isError ? "text-danger text-shadow-glow-danger" : "text-foreground",
                )}
              >
                {isLoading ? "CONNECTING..." : (statusData?.status ?? "UNKNOWN")}
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
              START
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

        {isRunning && statusData?.useStopLoss && statusData.stopLossTiers?.length > 0 && (
          <div className="mt-4 bg-orange-500/5 border border-orange-500/20 rounded-xl p-3 relative z-10">
            <p className="text-xs text-orange-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> Stop Loss Active
            </p>
            <div className="flex flex-wrap gap-2">
              {statusData.stopLossTiers.map((t, i) => {
                const isLast = i === (statusData.stopLossTiers?.length ?? 0) - 1;
                return (
                  <span key={i} className="text-xs font-mono bg-black/40 border border-orange-500/20 rounded-lg px-2 py-1 text-orange-300">
                    T{i + 1}: ${(t.priceCents / 100).toFixed(2)} → {isLast ? "ALL" : `${Math.round(t.fraction * 100)}%`}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {isRunning && !statusData?.useStopLoss && (
          <div className="mt-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3 relative z-10">
            <p className="text-xs text-yellow-400 flex items-center gap-1.5">
              <ShieldOff className="w-3.5 h-3.5" /> Stop Loss Disabled — holding to expiry
            </p>
          </div>
        )}

        {statusData?.lastError && (
          <div className="mt-4 bg-danger/10 border border-danger/20 rounded-xl p-4 flex items-start gap-3 text-danger relative z-10">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm font-mono break-all">{statusData.lastError}</div>
          </div>
        )}
      </div>

      <Modal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} title="Bot Configuration">
        <form onSubmit={handleStart} className="space-y-8">

          {/* ── Entry ── */}
          <div>
            <SectionHeader className="text-primary">Entry</SectionHeader>
            <div className="space-y-4">

              {/* Trigger range: threshold + max trigger side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>
                    Threshold <Hint text="Minimum contract price (¢) to trigger a buy. Bot enters when YES or NO ≥ this value." />
                  </FieldLabel>
                  <div className="flex items-center gap-1.5">
                    <NumberInput value={thresholdCents} onChange={setThresholdCents} min={1} max={99} />
                    <span className="text-muted-foreground text-xs shrink-0">¢</span>
                  </div>
                </div>
                <div>
                  <FieldLabel>
                    Max Trigger <Hint text="Bot refuses entry if spot price exceeds this. Blocks 98–99¢ entries where max gain is 1–2¢ but stop-loss downside is 7–9¢." />
                  </FieldLabel>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={maxTriggerPriceCents}
                      onChange={(v) => setMaxTriggerPriceCents(Math.min(99, Math.max(thresholdCents, v)))}
                      min={thresholdCents}
                      max={99}
                    />
                    <span className="text-muted-foreground text-xs shrink-0">¢</span>
                  </div>
                </div>
              </div>
              {maxTriggerPriceCents > 97 && (
                <p className="text-xs text-orange-400/80 -mt-1">
                  Warning: entries above 97¢ — max gain {100 - maxTriggerPriceCents}¢, tier-1 loss up to {maxTriggerPriceCents - 90}¢.
                </p>
              )}

              {/* Max Entry Price (order sweep ceiling) */}
              <div>
                <FieldLabel>
                  Order Ceiling <Hint text="The order is placed up to this price to sweep the book for fills. Trigger threshold is still the entry signal — this only controls how much you pay." />
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <NumberInput
                    value={maxEntryPriceCents}
                    onChange={(v) => setMaxEntryPriceCents(Math.min(99, Math.max(thresholdCents, v)))}
                    min={thresholdCents}
                    max={99}
                  />
                  <span className="text-muted-foreground text-sm font-mono shrink-0">
                    ¢{maxEntryPriceCents > thresholdCents ? ` (+${maxEntryPriceCents - thresholdCents}¢ sweep)` : " (exact)"}
                  </span>
                </div>
              </div>

              {/* Watch window + min time left side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <FieldLabel>
                    Watch Window <Hint text="How many seconds before expiry the bot starts monitoring a market." />
                  </FieldLabel>
                  <div className="flex items-center gap-1.5">
                    <NumberInput value={windowSeconds} onChange={setWindowSeconds} min={10} />
                    <span className="text-muted-foreground text-xs shrink-0">sec</span>
                  </div>
                </div>
                <div>
                  <FieldLabel>
                    Min Time Left <Hint text="Refuse entry if fewer than this many seconds remain. Prevents last-second buys where stop-losses can't execute." />
                  </FieldLabel>
                  <div className="flex items-center gap-1.5">
                    <NumberInput value={minTimeLeftSeconds} onChange={(v) => setMinTimeLeftSeconds(Math.max(1, v))} min={1} />
                    <span className="text-muted-foreground text-xs shrink-0">sec</span>
                  </div>
                </div>
              </div>

              {/* Poll interval — tucked away, rarely changed */}
              <div>
                <FieldLabel>
                  Poll Interval <Hint text="How often (ms) the bot checks prices. 500ms = twice per second. Lower is faster but more API calls." />
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <NumberInput value={checkIntervalMs} onChange={setCheckIntervalMs} min={100} max={5000} />
                  <span className="text-muted-foreground text-sm shrink-0">ms</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Momentum Filter (EMA) ── */}
          <div className="border-t border-card-border pt-6">
            <div className="flex items-center justify-between mb-3">
              <SectionHeader className="text-primary mb-0">
                <TrendingUp className="w-3.5 h-3.5" /> Momentum Filter
              </SectionHeader>
              <Toggle value={useEma} onChange={setUseEma} />
            </div>
            {!useEma ? (
              <p className="text-xs text-muted-foreground">
                Off — bot enters as soon as price crosses threshold.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <FieldLabel>
                    EMA Smoothing <Hint text="How quickly the EMA reacts (α). Lower = smoother/slower. Range 1–100, sent as /100." />
                  </FieldLabel>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={Math.round(emaAlpha * 100)}
                      onChange={(v) => setEmaAlpha(Math.min(100, Math.max(1, v)) / 100)}
                      min={1}
                      max={100}
                    />
                    <span className="text-muted-foreground text-xs shrink-0">α={emaAlpha.toFixed(2)}</span>
                  </div>
                </div>
                <div>
                  <FieldLabel>
                    EMA Threshold <Hint text="EMA must reach this value before entry fires. Higher = more confirmation required." />
                  </FieldLabel>
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      value={emaThreshold}
                      onChange={(v) => setEmaThreshold(Math.min(99, Math.max(1, v)))}
                      min={1}
                      max={99}
                    />
                    <span className="text-muted-foreground text-xs shrink-0">¢</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Position Size ── */}
          <div className="border-t border-card-border pt-6">
            <SectionHeader className="text-primary">Position Size</SectionHeader>
            <div className="flex rounded-xl border border-card-border overflow-hidden mb-3">
              <button
                type="button"
                onClick={() => setUseAllBalance(false)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-all",
                  !useAllBalance ? "bg-primary/20 text-primary" : "bg-black/40 text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                <Hash className="w-4 h-4" /> Fixed
              </button>
              <button
                type="button"
                onClick={() => setUseAllBalance(true)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-all",
                  useAllBalance ? "bg-danger/20 text-danger" : "bg-black/40 text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                <Wallet className="w-4 h-4" /> Full Balance
              </button>
            </div>
            {!useAllBalance ? (
              <div className="flex items-center gap-2">
                <NumberInput value={tradeSize} onChange={(v) => setTradeSize(Math.max(1, v))} min={1} />
                <span className="text-muted-foreground text-sm shrink-0">contracts</span>
              </div>
            ) : (
              <div className="bg-danger/5 border border-danger/20 rounded-xl p-3">
                <p className="text-xs text-danger flex items-center gap-2">
                  <Wallet className="w-3.5 h-3.5 shrink-0" />
                  Stakes your entire account balance on every trade.
                </p>
              </div>
            )}
          </div>

          {/* ── Stop Loss ── */}
          <div className="border-t border-card-border pt-6">
            <div className="flex items-center justify-between mb-4">
              <SectionHeader className="text-orange-400 mb-0">
                <Shield className="w-3.5 h-3.5" /> Stop Loss
              </SectionHeader>
              <Toggle value={useStopLoss} onChange={setUseStopLoss} color="orange" />
            </div>

            {!useStopLoss && (
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-3">
                <p className="text-xs text-yellow-400 flex items-center gap-2">
                  <ShieldOff className="w-3.5 h-3.5" /> Off — positions held to expiry.
                </p>
              </div>
            )}

            {useStopLoss && (
              <div className="space-y-4">
                <div className="flex rounded-xl border border-card-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setUseTrailingStop(false)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-all",
                      !useTrailingStop ? "bg-orange-500/20 text-orange-400" : "bg-black/40 text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    <ArrowDownUp className="w-4 h-4" /> Tiered
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseTrailingStop(true)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-all",
                      useTrailingStop ? "bg-orange-500/20 text-orange-400" : "bg-black/40 text-muted-foreground hover:text-foreground hover:bg-white/5"
                    )}
                  >
                    <TrendingDown className="w-4 h-4" /> Trailing
                  </button>
                </div>

                {useTrailingStop && (
                  <div>
                    <FieldLabel>
                      Trail Distance <Hint text="Sells 100% of position when price drops this many cents below the highest price seen since entry." />
                    </FieldLabel>
                    <div className="flex items-center gap-2">
                      <NumberInput value={trailingStopCents} onChange={(v) => setTrailingStopCents(Math.max(1, v))} min={1} max={50} />
                      <span className="text-muted-foreground text-sm shrink-0">¢ below peak</span>
                    </div>
                  </div>
                )}

                {!useTrailingStop && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-12 gap-2 mb-1">
                      <p className="col-span-1 text-xs text-muted-foreground">#</p>
                      <p className="col-span-5 text-xs text-muted-foreground flex items-center gap-1">
                        Trigger <Hint text="If price falls to this level, the sell fires." />
                      </p>
                      <p className="col-span-5 text-xs text-muted-foreground flex items-center gap-1">
                        Sell <Hint text="% of your total position to sell at this tier. Last tier always sells all remaining." />
                      </p>
                      <p className="col-span-1" />
                    </div>

                    {tiers.map((tier, i) => {
                      const isLast = i === tiers.length - 1;
                      return (
                        <div key={i} className="grid grid-cols-12 gap-2 items-center">
                          <span className="col-span-1 text-xs font-bold text-orange-400 font-mono">T{i + 1}</span>
                          <div className="col-span-5 flex items-center gap-1">
                            <NumberInput
                              value={tier.priceCents}
                              onChange={(v) => updateTier(i, "priceCents", Math.min(99, Math.max(1, v)))}
                              min={1}
                              max={99}
                            />
                            <span className="text-muted-foreground text-xs shrink-0">¢</span>
                          </div>
                          <div className="col-span-5">
                            {isLast ? (
                              <div className="bg-black/30 border border-orange-500/20 rounded-xl px-3 py-2.5 text-sm font-mono text-orange-300 text-center">
                                ALL
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <NumberInput
                                  value={Math.round(tier.fraction * 100)}
                                  onChange={(v) => updateTier(i, "fraction", Math.min(99, Math.max(1, v)) / 100)}
                                  min={1}
                                  max={99}
                                />
                                <span className="text-muted-foreground text-xs shrink-0">%</span>
                              </div>
                            )}
                          </div>
                          <div className="col-span-1 flex justify-center">
                            {tiers.length > 1 && (
                              <button type="button" onClick={() => removeTier(i)} className="text-muted-foreground hover:text-danger transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {tiers.length < 5 && (
                      <button
                        type="button"
                        onClick={addTier}
                        className="mt-1 w-full py-2 rounded-xl border border-dashed border-white/10 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-all flex items-center justify-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Tier
                      </button>
                    )}

                    <p className="text-xs text-muted-foreground pt-1">
                      Tiers fire in order. The last tier always sells all remaining contracts.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={startMutation.isPending}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-bold hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Play className="w-4 h-4 fill-current" />
            {startMutation.isPending ? "Starting..." : "Launch Bob"}
          </button>
        </form>
      </Modal>
    </>
  );
}
