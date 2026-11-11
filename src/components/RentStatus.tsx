import clsx from "clsx";
import type { MonthStatus } from "@/lib/engine/rentroll";
import { monthLabel } from "@/lib/engine/dates";

export const RENT_STATUS: Record<MonthStatus, { label: string; dot: string; chip: string }> = {
  PAID: { label: "Paid on time", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-800" },
  LATE: { label: "Paid late", dot: "bg-amber-400", chip: "bg-amber-50 text-amber-800" },
  PARTIAL: { label: "Partly paid", dot: "bg-orange-500", chip: "bg-orange-50 text-orange-800" },
  UNPAID: { label: "Not paid", dot: "bg-red-500", chip: "bg-red-50 text-red-700" },
  AHEAD: { label: "Paid ahead", dot: "bg-sky-500", chip: "bg-sky-50 text-sky-800" },
  UPCOMING: { label: "Not due yet", dot: "border border-slate-300 bg-white", chip: "bg-slate-100 text-slate-600" },
  NO_LEASE: { label: "No lease", dot: "bg-slate-100", chip: "bg-slate-50 text-slate-400" },
  NO_DATA: { label: "Not tracked yet", dot: "bg-slate-200 bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,#fff_2px,#fff_4px)]", chip: "bg-slate-50 text-slate-500" },
};

export function StatusChip({ status }: { status: MonthStatus }) {
  const s = RENT_STATUS[status];
  return <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", s.chip)}><span className={clsx("h-2 w-2 rounded-full", s.dot)} />{s.label}</span>;
}

/** One dot per month, oldest first. */
export function MonthDots({ months }: { months: { month: string; status: MonthStatus }[] }) {
  return (
    <div className="flex gap-1" aria-label="Last 12 months">
      {months.map((m) => <span key={m.month} title={`${monthLabel(m.month)}: ${RENT_STATUS[m.status].label}`} className={clsx("h-3 w-3 rounded-sm", RENT_STATUS[m.status].dot)} />)}
    </div>
  );
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {(["PAID", "LATE", "PARTIAL", "UNPAID", "AHEAD", "UPCOMING", "NO_DATA"] as MonthStatus[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5"><span className={clsx("h-2.5 w-2.5 rounded-sm", RENT_STATUS[k].dot)} />{RENT_STATUS[k].label}</span>
      ))}
    </div>
  );
}
