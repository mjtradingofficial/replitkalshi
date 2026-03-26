import React, { useState } from "react";
import { motion } from "framer-motion";
import { Terminal, BookOpen, Trophy } from "lucide-react";
import { StatusCard } from "@/components/StatusCard";
import { MarketCard } from "@/components/MarketCard";
import { TradeHistory } from "@/components/TradeHistory";
import { DashboardStats } from "@/components/DashboardStats";
import { SettlementHistory } from "@/components/SettlementHistory";
import { cn } from "@/lib/utils";

type Tab = "settlements" | "trades";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("settlements");

  return (
    <div className="min-h-screen relative pb-12">
      {/* Abstract Background Glows */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-[1000px] h-[500px] bg-primary/10 rounded-[100%] blur-[120px] pointer-events-none -z-10 mix-blend-screen" />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-danger/5 rounded-[100%] blur-[120px] pointer-events-none -z-10 mix-blend-screen" />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4 mb-10 border-b border-card-border pb-6"
        >
          <div className="w-14 h-14 bg-black border border-primary/30 rounded-2xl flex items-center justify-center shadow-[0_0_30px_-5px_rgba(0,240,255,0.4)]">
            <Terminal className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
              Bob
              <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-xs font-mono tracking-widest border border-primary/30 align-middle">v1.0.0</span>
            </h1>
            <p className="text-muted-foreground text-sm tracking-wide mt-1 font-mono">AUTONOMOUS BTC 15-MIN OPTIONS EXECUTION</p>
          </div>
        </motion.header>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <DashboardStats />
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-4 space-y-8"
          >
            <StatusCard />
            <MarketCard />
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="lg:col-span-8"
          >
            {/* Tab header */}
            <div className="flex gap-1 mb-0 glass-panel rounded-t-2xl rounded-b-none border-b-0 px-4 pt-4 pb-0">
              <button
                onClick={() => setActiveTab("settlements")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-all border-b-2",
                  activeTab === "settlements"
                    ? "text-primary border-primary bg-primary/5"
                    : "text-muted-foreground border-transparent hover:text-foreground hover:bg-white/5"
                )}
              >
                <Trophy className="w-4 h-4" />
                Settlements
              </button>
              <button
                onClick={() => setActiveTab("trades")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-all border-b-2",
                  activeTab === "trades"
                    ? "text-primary border-primary bg-primary/5"
                    : "text-muted-foreground border-transparent hover:text-foreground hover:bg-white/5"
                )}
              >
                <BookOpen className="w-4 h-4" />
                Trade Log
              </button>
            </div>

            {/* Tab content */}
            <div className={activeTab === "settlements" ? "block" : "hidden"}>
              <SettlementHistory noHeader />
            </div>
            <div className={activeTab === "trades" ? "block" : "hidden"}>
              <TradeHistory noHeader />
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
