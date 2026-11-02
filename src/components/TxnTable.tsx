import Link from "next/link";
import { Paperclip, Repeat, AlertCircle, ArrowLeftRight } from "lucide-react";
import { formatDate } from "@/lib/engine/dates";
import { KIND_LABELS } from "@/lib/engine/classify";
import type { TxnRow } from "@/lib/services/query";
import { Badge, Money } from "./ui";

const SPENDISH = new Set(["PURCHASE", "FEE", "INTEREST"]);

export function TxnTable({ rows, accountant, reviewIds = new Set(), showAccount = true, empty }: { rows: (TxnRow & { _count?: { receipts: number } })[]; accountant: boolean; reviewIds?: Set<string>; showAccount?: boolean; empty?: React.ReactNode }) {
  if (!rows.length) return <div className="p-8 text-center text-sm text-slate-500">{empty ?? "No transactions match these filters."}</div>;
  return (
    <>
      {/* Desktop table */}
      <table className="hidden w-full md:table">
        <thead className="border-b border-slate-100 bg-slate-50/60">
          <tr>
            <th className="th">Date</th><th className="th">Description</th>{showAccount && <th className="th">Account</th>}<th className="th">Category</th><th className="th text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((t) => (
            <tr key={t.id} className={`group hover:bg-slate-50 ${t.excluded ? "opacity-50" : ""}`}>
              <td className="td whitespace-nowrap text-slate-500"><Link href={`/transactions/${t.id}`} className="block">{formatDate(t.date)}</Link></td>
              <td className="td max-w-[22rem]">
                <Link href={`/transactions/${t.id}`} className="block">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-slate-900 group-hover:text-brand-700">{t.merchant?.name ?? t.description}</span>
                    {reviewIds.has(t.id) && <span title="Needs your review"><AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" /></span>}
                    {t.transferGroupId && <span title="Linked to the other side of this transfer"><ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-slate-400" /></span>}
                    {t.splits.length > 0 && <span title="Split across categories"><Repeat className="h-3.5 w-3.5 shrink-0 text-slate-400" /></span>}
                    {(t._count?.receipts ?? 0) > 0 && <span title="Receipt attached"><Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" /></span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{accountant ? t.originalDescription : t.description !== (t.merchant?.name ?? "") ? t.description : ""}</div>
                </Link>
              </td>
              {showAccount && <td className="td whitespace-nowrap text-slate-600">{t.account.name}{t.account.mask ? <span className="text-slate-400"> ··{t.account.mask}</span> : null}</td>}
              <td className="td">
                {SPENDISH.has(t.kind) || t.kind === "REFUND" ? (
                  <span className="text-slate-700">{t.splits.length ? "Split" : t.category ? (t.category.parent ? t.category.name : t.category.name) : "Uncategorized"}</span>
                ) : (
                  <Badge tone={t.kind === "INCOME" ? "green" : "slate"}>{accountant ? KIND_LABELS[t.kind].accountant : KIND_LABELS[t.kind].simple}</Badge>
                )}
                {t.kind === "REFUND" && <Badge tone="green">Refund</Badge>}
                {t.status === "PENDING" && <Badge tone="amber">Pending</Badge>}
                {t.excluded && <Badge tone="red">Excluded</Badge>}
              </td>
              <td className="td text-right font-semibold"><Money cents={t.amountCents} currency={t.currency} colored /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Mobile list */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {rows.map((t) => (
          <li key={t.id}>
            <Link href={`/transactions/${t.id}`} className={`flex items-center gap-3 px-4 py-3 active:bg-slate-50 ${t.excluded ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate font-medium text-slate-900">{t.merchant?.name ?? t.description}{reviewIds.has(t.id) && <AlertCircle className="h-3.5 w-3.5 text-amber-500" />}</div>
                <div className="truncate text-xs text-slate-500">{formatDate(t.date)} · {t.account.name} · {SPENDISH.has(t.kind) ? t.category?.name ?? "Uncategorized" : KIND_LABELS[t.kind].simple}</div>
              </div>
              <Money cents={t.amountCents} currency={t.currency} colored className="font-semibold" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
