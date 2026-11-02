import Link from "next/link";
import { TrendingUp, TrendingDown, Info, AlertTriangle, ChevronRight } from "lucide-react";
import type { Insight } from "@/lib/engine/insights";
import { txnLink } from "@/lib/filters";

export function InsightList({ insights }: { insights: Insight[] }) {
  if (!insights.length) return <p className="text-sm text-slate-500">Nothing unusual this month.</p>;
  return (
    <ul className="space-y-2">
      {insights.map((i, n) => {
        const Icon = i.tone === "up" ? TrendingUp : i.tone === "down" ? TrendingDown : i.tone === "warning" ? AlertTriangle : Info;
        const color = i.tone === "up" ? "text-red-600 bg-red-50" : i.tone === "down" ? "text-emerald-600 bg-emerald-50" : i.tone === "warning" ? "text-amber-600 bg-amber-50" : "text-brand-600 bg-brand-50";
        const href = i.href ?? txnLink({}, i.link ?? {});
        return (
          <li key={n}>
            <Link href={href} className="group flex items-start gap-3 rounded-xl p-2 hover:bg-slate-50">
              <span className={`mt-0.5 rounded-lg p-1.5 ${color}`}><Icon className="h-4 w-4" /></span>
              <span className={`flex-1 text-[15px] leading-relaxed text-slate-700 ${n === 0 ? "font-medium text-slate-900" : ""}`}>{i.text}</span>
              <span className="mt-1 hidden items-center text-xs font-medium text-brand-600 opacity-0 transition group-hover:opacity-100 sm:flex">See transactions <ChevronRight className="h-3.5 w-3.5" /></span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
