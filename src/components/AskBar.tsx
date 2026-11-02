"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles, ArrowRight } from "lucide-react";

export function AskBar({ initial = "", size = "md", suggestions = [] }: { initial?: string; size?: "md" | "lg"; suggestions?: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const go = (text: string) => { if (text.trim()) router.push(`/ask?q=${encodeURIComponent(text.trim())}`); };
  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); go(q); }} role="search" className="relative">
        <Sparkles className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-brand-500 ${size === "lg" ? "h-5 w-5" : "h-4 w-4"}`} />
        <input
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask a question about your spending"
          placeholder="Ask anything about your business spending..."
          className={`w-full rounded-2xl border border-slate-200 bg-white pl-11 pr-12 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 ${size === "lg" ? "py-4 text-base" : "py-2.5 text-sm"}`}
        />
        <button aria-label="Ask" className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-xl bg-brand-600 text-white hover:bg-brand-700"><ArrowRight className="h-4 w-4" /></button>
      </form>
      {suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => go(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700">{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
