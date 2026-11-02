import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthLabel } from "@/lib/engine/dates";

export function MonthPicker({ month, basePath, extra = "", latest }: { month: string; basePath: string; extra?: string; latest?: string }) {
  const prev = addMonths(month, -1), next = addMonths(month, 1);
  const canNext = !latest || next <= latest;
  return (
    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      <Link href={`${basePath}?month=${prev}${extra}`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Previous month, ${monthLabel(prev)}`}><ChevronLeft className="h-4 w-4" /></Link>
      <span className="min-w-[8.5rem] px-2 text-center text-sm font-semibold text-slate-800">{monthLabel(month)}</span>
      {canNext ? <Link href={`${basePath}?month=${next}${extra}`} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Next month, ${monthLabel(next)}`}><ChevronRight className="h-4 w-4" /></Link>
        : <span className="p-1.5 text-slate-200"><ChevronRight className="h-4 w-4" /></span>}
    </div>
  );
}
