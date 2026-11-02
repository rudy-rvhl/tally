import Link from "next/link";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { statementResult } from "@/lib/services/reconciliation";
import { formatDate, isoDate } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { ActionForm } from "./ActionForm";
import { adjustmentAction, recheckStatementAction } from "@/app/actions";

export async function ReconciliationCard({ userId, statementId, accountant }: { userId: string; statementId: string; accountant: boolean }) {
  const { statement: st, result: r } = await statementResult(userId, statementId);
  const cur = st.account.currency;
  const fmt = (c: number) => formatMoney(c, cur);
  const link = `/transactions?account=${st.accountId}&from=${isoDate(st.periodStart)}&to=${isoDate(st.periodEnd)}`;
  return (
    <div className={`rounded-xl border p-4 ${r.balanced ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          {r.balanced ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />}
          {formatDate(st.periodStart)} – {formatDate(st.periodEnd)}
        </div>
        <span className={`text-sm font-semibold ${r.balanced ? "text-emerald-700" : "text-amber-800"}`}>
          {r.balanced ? "Matches your statement" : `Off by ${fmt(Math.abs(r.differenceCents))}`}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        <div><dt className="text-slate-500">{r.liability ? "Owed at start" : "Starting balance"}</dt><dd className="num font-medium">{fmt(r.openingCents)}</dd></div>
        <div><dt className="text-slate-500">{r.liability ? "+ Charges" : "+ Money in"}</dt><dd className="num font-medium"><Link className="hover:underline" href={`${link}&kind=${r.liability ? "spending" : "income"}`}>{fmt(r.liability ? r.outflowsCents : r.inflowsCents)}</Link></dd></div>
        <div><dt className="text-slate-500">{r.liability ? "− Payments & credits" : "− Money out"}</dt><dd className="num font-medium">{fmt(r.liability ? r.inflowsCents : r.outflowsCents)}</dd></div>
        <div><dt className="text-slate-500">= We calculate</dt><dd className="num font-semibold">{fmt(r.calculatedClosingCents)}</dd></div>
        <div className="col-span-2 sm:col-span-4"><dt className="inline text-slate-500">Statement says: </dt><dd className="num inline font-semibold">{fmt(r.statementClosingCents)}</dd> <span className="text-slate-400">· {r.transactionCount} posted transactions{r.pendingExcluded ? `, ${r.pendingExcluded} pending not counted` : ""} · <Link className="link" href={link}>see them</Link></span></div>
      </dl>
      {!r.balanced && (
        <div className="mt-3 space-y-1 text-sm text-amber-900">
          <p className="font-medium">What might be wrong:</p>
          <ul className="list-disc pl-5">{r.hints.map((h) => <li key={h}>{h}</li>)}</ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <form action={recheckStatementAction}><input type="hidden" name="statementId" value={st.id} /><button className="btn-secondary btn-sm">Check again</button></form>
        {!r.balanced && accountant && (
          <ActionForm action={adjustmentAction} className="flex flex-1 flex-wrap gap-2">
            <input type="hidden" name="statementId" value={st.id} />
            <input name="memo" className="input min-w-[12rem] flex-1 py-1.5 text-sm" placeholder="Reason for correction (kept in audit log)" aria-label="Reason" />
            <button className="btn-secondary btn-sm">Book {fmt(Math.abs(r.differenceCents))} correction</button>
          </ActionForm>
        )}
      </div>
    </div>
  );
}
