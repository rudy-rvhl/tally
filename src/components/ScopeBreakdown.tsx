import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { summarize } from "@/lib/engine/analytics";
import { formatMoney } from "@/lib/engine/money";
import type { AnalyticTxn } from "@/lib/engine/types";
import type { BreakdownRow } from "@/lib/scope";
import { ScopeLink } from "./ScopeSwitch";

/**
 * Money per company/building. Each row opens the same screen for just that company or
 * building. `mode="overview"` shows spent / received / left over; "spending" shows spent only.
 */
export function ScopeBreakdown({ rows, currency, href, mode = "overview" }: { rows: BreakdownRow<AnalyticTxn>[]; currency: string; href: string; mode?: "overview" | "spending" }) {
  const sums = rows.map((r) => summarize(r.rows));
  const top = Math.max(1, ...sums.map((s) => s.spendingCents));
  return (
    <table className="w-full table-fixed text-sm" data-testid="scope-breakdown">
      <thead className="border-b border-slate-100">
        <tr>
          <th className="th w-[45%] sm:w-auto">{rows.some((r) => r.depth === 1) ? "Company / building" : "Building"}</th>
          <th className="th text-right">Spent</th>
          {mode === "overview" && <><th className="th hidden text-right sm:table-cell">Received</th><th className="th text-right">Left over</th></>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r, i) => {
          const s = sums[i];
          const name = (
            <span className={clsx("flex items-center gap-1", r.depth === 1 && "pl-5", r.depth === 0 && rows.some((x) => x.depth === 1) && "font-semibold")}>
              <span className={clsx("min-w-0 break-words", r.value ? "text-slate-900 group-hover:text-brand-700" : "italic text-slate-500")}>{r.label}</span>
              {r.value && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-brand-500" />}
            </span>
          );
          return (
            <tr key={`${r.value}-${r.label}`} className={clsx(r.value && "group hover:bg-slate-50")}>
              <td className="td">
                {r.value ? <ScopeLink value={r.value} href={href} className="block w-full" title={`Show only ${r.label}`}>{name}</ScopeLink> : <span title="Money on accounts used by several buildings. Assign it to a building on the transaction or the account.">{name}</span>}
                {mode === "spending" && <div className={clsx("mt-1 h-1 max-w-[16rem] rounded-full bg-slate-100", r.depth === 1 && "ml-5")}><div className="h-1 rounded-full bg-brand-500" style={{ width: `${Math.max(2, (s.spendingCents / top) * 100)}%` }} /></div>}
              </td>
              <td className="td text-right num font-semibold">{formatMoney(s.spendingCents, currency)}</td>
              {mode === "overview" && <>
                <td className="td hidden text-right num text-emerald-700 sm:table-cell">{formatMoney(s.incomeCents, currency)}</td>
                <td className={clsx("td text-right num", s.netCashFlowCents < 0 ? "text-red-700" : "text-emerald-700")}>{formatMoney(s.netCashFlowCents, currency)}</td>
              </>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
