import React from "react";
import { motion } from "framer-motion";
import { Terminal } from "lucide-react";
import { StatusCard } from "@/components/StatusCard";
import { MarketCard } from "@/components/MarketCard";
import { TradeHistory } from "@/components/TradeHistory";
import { DashboardStats } from "@/components/DashboardStats";

export default function Dashboard() {
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
              KALSHI NEURAL-NET
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
            <TradeHistory />
          </motion.div>
        </div>
      </main>
    </div>
  );
}
