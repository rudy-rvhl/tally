import Link from "next/link";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFilters, toQuery } from "@/lib/filters";
import { buildWhere, loadAnalytic, txnInclude } from "@/lib/services/query";
import { filterOptions } from "@/lib/services/options";
import { summarize } from "@/lib/engine/analytics";
import { formatMoney } from "@/lib/engine/money";
import { monthLabel } from "@/lib/engine/dates";
import { Card, Notice, PageHeader } from "@/components/ui";
import { FilterBar } from "@/components/FilterBar";
import { TxnTable } from "@/components/TxnTable";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Transactions" };
const PAGE = 50;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const f = readFilters(await searchParams);
  const where = await buildWhere(user.id, f, { includeExcluded: f.review === "excluded" });
  if (f.review === "excluded") where.excluded = true;
  const page = Math.max(1, Number(f.page) || 1);
  const orderBy = f.sort === "amount" ? [{ amountCents: "asc" as const }] : f.sort === "oldest" ? [{ date: "asc" as const }] : [{ date: "desc" as const }, { createdAt: "desc" as const }];
  const [rows, count, { txns, conversion }, reviews, options] = await Promise.all([
    prisma.transaction.findMany({ where, include: { ...txnInclude, _count: { select: { receipts: true } } }, orderBy, take: PAGE, skip: (page - 1) * PAGE }),
    prisma.transaction.count({ where }),
    loadAnalytic(user, f),
    prisma.reviewItem.findMany({ where: { userId: user.id, status: "OPEN", txnId: { not: null } }, select: { txnId: true } }),
    filterOptions(user, { show: ["q", "month", "account", "category", "kind", "ownership", "currency", "institution"] }),
  ]);
  const s = summarize(txns);
  const c = user.baseCurrency;
  const merchant = f.merchant ? await prisma.merchant.findFirst({ where: { id: f.merchant, userId: user.id } }) : null;
  const title = merchant ? `${merchant.name} transactions` : f.month ? `Transactions in ${monthLabel(f.month)}` : "Transactions";
  const pages = Math.ceil(count / PAGE);

  return (
    <>
      <PageHeader back={<BackLink fallback="/" />} title={title} subtitle={`${count.toLocaleString()} transaction${count === 1 ? "" : "s"} match these filters`}
        actions={<a href={`/api/export${toQuery(f, { page: undefined })}`} className="btn-secondary"><Download className="h-4 w-4" /> Export CSV</a>} />
      <FilterBar options={options} />
      {conversion.missing.length > 0 && <div className="mb-4"><Notice tone="amber">Some foreign-currency transactions are listed but not included in the totals because no exchange rate has been entered for their month.</Notice></div>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Money spent", s.spendingCents, "Purchases, fees and interest minus refunds"], ["Money received", s.incomeCents, ""], ["Moved between accounts", s.movementCents.cardPayments + s.movementCents.transfers + s.movementCents.loanPayments, "Not counted as spending"], ["Left over", s.netCashFlowCents, "Received minus spent"]].map(([l, v, h]) => (
          <div key={l as string} className="card px-4 py-3">
            <div className="text-xs font-medium text-slate-500">{l}</div>
            <div className="num text-lg font-bold">{formatMoney(v as number, c)}</div>
            {h && <div className="text-[11px] text-slate-400">{h}</div>}
          </div>
        ))}
      </div>
      <Card padded={false}
        title={<span className="text-sm">Sorted by {f.sort === "amount" ? "largest amount" : f.sort === "oldest" ? "oldest first" : "newest first"}</span>}
        action={<div className="flex gap-1 text-xs">{[["", "Newest"], ["oldest", "Oldest"], ["amount", "Largest"]].map(([v, l]) => <Link key={v} href={`/transactions${toQuery(f, { sort: v || undefined, page: undefined })}`} className={`rounded-lg px-2 py-1 ${((f.sort ?? "") === v) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{l}</Link>)}</div>}>
        <TxnTable rows={rows} accountant={user.mode === "ACCOUNTANT"} reviewIds={new Set(reviews.map((r) => r.txnId!))} />
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <Link className="btn-secondary btn-sm" href={`/transactions${toQuery(f, { page: String(page - 1) })}`}>Previous</Link>}
              {page < pages && <Link className="btn-secondary btn-sm" href={`/transactions${toQuery(f, { page: String(page + 1) })}`}>Next</Link>}
            </div>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-400">
        <Link href={`/transactions?review=excluded`} className="hover:underline">Show transactions marked as duplicates</Link>
      </p>
    </>
  );
}
