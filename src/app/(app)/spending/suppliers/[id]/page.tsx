import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readFilters, toQuery, txnLink } from "@/lib/filters";
import { buildWhere, latestMonth, loadAnalytic, txnInclude } from "@/lib/services/query";
import { filterOptions, lastNMonths } from "@/lib/services/options";
import { byCategory, bySubcategory, detectRecurring, groupSpending, monthlySeries, spendOf, summarize } from "@/lib/engine/analytics";
import { addMonths, formatDate, monthKey, monthLabel } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { BarList, Card, Badge, PageHeader, Stat } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { FilterBar } from "@/components/FilterBar";
import { TxnTable } from "@/components/TxnTable";
import { TrendChart } from "@/components/charts";
import { ActionForm } from "@/components/ActionForm";
import { renameMerchantAction } from "@/app/actions";

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { id } = await params;
  const f = readFilters(await searchParams);
  const merchant = await prisma.merchant.findFirst({ where: { id, userId: user.id }, include: { aliases: true, defaultCategory: true } });
  if (!merchant) notFound();
  const c = user.baseCurrency;
  const latest = await latestMonth(user.id);
  const yearStart = `${latest.slice(0, 4)}-01-01`;
  const scoped = { ...f, merchant: id };
  const [life, filtered, accounts] = await Promise.all([
    loadAnalytic(user, { merchant: id }),
    loadAnalytic(user, scoped),
    prisma.account.findMany({ where: { userId: user.id }, select: { id: true, name: true, institution: true, mask: true } }),
  ]);
  const all = life.txns;
  const purchases = all.filter((t) => t.kind === "PURCHASE");
  const amounts = purchases.map((t) => -t.amountCents);
  const lifeSum = summarize(all);
  const thisMonth = all.filter((t) => monthKey(t.date) === latest).reduce((a, t) => a + spendOf(t), 0);
  const lastMonth = all.filter((t) => monthKey(t.date) === addMonths(latest, -1)).reduce((a, t) => a + spendOf(t), 0);
  const ytd = all.filter((t) => t.date >= new Date(`${yearStart}T00:00:00Z`)).reduce((a, t) => a + spendOf(t), 0);
  const accCounts = new Map<string, number>();
  for (const t of purchases) accCounts.set(t.accountId, (accCounts.get(t.accountId) ?? 0) + 1);
  const topAccount = [...accCounts].sort((a, b) => b[1] - a[1])[0];
  const topAccountName = topAccount ? accounts.find((a) => a.id === topAccount[0])?.name : null;
  const months = lastNMonths(latest, 12);
  const firstMonth = all.length ? monthKey(all[0].date) : latest;
  const series = monthlySeries(all, months).filter((p) => p.month >= firstMonth);
  const recurring = detectRecurring(all)[0];
  const refunds = all.filter((t) => t.kind === "REFUND" || t.kind === "REVERSAL");
  const byAcc = groupSpending(filtered.txns, (t) => ({ key: t.accountId, label: accounts.find((a) => a.id === t.accountId)?.name ?? "Account" }));
  const byCat = groupSpending(filtered.txns, bySubcategory);
  void byCategory;
  const where = await buildWhere(user.id, scoped);
  const rows = await prisma.transaction.findMany({ where, include: { ...txnInclude, _count: { select: { receipts: true } } }, orderBy: { date: "desc" }, take: 200 });
  const options = await filterOptions(user, { show: ["q", "month", "account", "category", "kind"] });
  const fs = summarize(filtered.txns);

  return (
    <>
      <PageHeader back={<BackLink fallback="/spending" label="Back" />} title={merchant.name}
        subtitle={<>{purchases.length} purchase{purchases.length === 1 ? "" : "s"} across {accCounts.size} account{accCounts.size === 1 ? "" : "s"}{recurring ? <> · <Badge tone="violet">Regular {recurring.cadence === "monthly" ? "monthly " : ""}charge, about {formatMoney(recurring.typicalCents, c)}</Badge></> : null}</>}
        actions={<a className="btn-secondary" href={`/api/export${toQuery(scoped)}`}><Download className="h-4 w-4" /> Export</a>} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total spent, all time" value={formatMoney(lifeSum.spendingCents, c)} href={txnLink({}, { merchant: id })} />
        <Stat label={monthLabel(latest)} value={formatMoney(thisMonth, c)} href={txnLink({}, { merchant: id, month: latest })} hint={`${monthLabel(addMonths(latest, -1), "short")}: ${formatMoney(lastMonth, c)}`} />
        <Stat label="This year so far" value={formatMoney(ytd, c)} href={txnLink({}, { merchant: id, from: yearStart })} />
        <Stat label="Average purchase" value={formatMoney(lifeSum.averagePurchaseCents, c)} hint={amounts.length ? `Highest ${formatMoney(Math.max(...amounts), c)} · Lowest ${formatMoney(Math.min(...amounts), c)}` : undefined} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Spending history" subtitle={`${series.length === 12 ? "Last 12 months" : `Since ${monthLabel(firstMonth)}`}. Click a month to filter the list below.`} className="lg:col-span-2">
          <TrendChart showIncome={false} height={220} data={series.map((p) => ({ label: monthLabel(p.month, "short"), spending: p.spendingCents, href: `/spending/suppliers/${id}?month=${p.month}` }))} />
        </Card>
        <div className="space-y-6">
          <Card title="Which accounts paid" subtitle={topAccountName ? `Used most: ${topAccountName}` : undefined}>
            <BarList currency={c} items={byAcc.map((a) => ({ label: a.label, value: a.spendCents, sub: `${a.count} purchases`, href: `/spending/suppliers/${id}${toQuery(f, { account: a.key })}` }))} />
          </Card>
          <Card title="What it was for" subtitle="A supplier can cover several categories.">
            <BarList currency={c} items={byCat.map((g) => ({ label: g.label, value: g.spendCents, sub: `${g.count}`, href: `/spending/suppliers/${id}${toQuery(f, { category: g.key === "none" ? undefined : g.key })}` }))} />
          </Card>
        </div>
      </div>

      <FilterBar options={options} />
      <Card padded={false} title={`${rows.length} transaction${rows.length === 1 ? "" : "s"}`} subtitle={`Spent ${formatMoney(fs.spendingCents, c)}${fs.refundsCents ? ` after ${formatMoney(fs.refundsCents, c)} of refunds` : ""}`} className="mb-6">
        <TxnTable rows={rows} accountant={user.mode === "ACCOUNTANT"} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Refunds" subtitle={refunds.length ? undefined : "No refunds from this supplier."}>
          <ul className="divide-y divide-slate-100 text-sm">
            {refunds.map((r) => <li key={r.id}><Link href={`/transactions/${r.id}`} className="flex justify-between py-2 hover:text-brand-700"><span>{formatDate(r.date)}</span><span className="num text-emerald-700">{formatMoney(r.amountCents, c)}</span></Link></li>)}
          </ul>
        </Card>
        <Card title="Supplier name" subtitle="Rename it, or give it the name of another supplier to combine them.">
          <ActionForm action={renameMerchantAction} className="flex gap-2">
            <input type="hidden" name="merchantId" value={id} />
            <input name="name" className="input" defaultValue={merchant.name} aria-label="Supplier name" />
            <button className="btn-secondary">Save</button>
          </ActionForm>
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-slate-500">Statement wordings combined into this supplier ({merchant.aliases.length})</summary>
            <ul className="mt-2 space-y-1 font-mono text-xs text-slate-600">{merchant.aliases.map((a) => <li key={a.id}>{a.pattern} {a.source === "USER" && <Badge>you</Badge>}</li>)}</ul>
          </details>
        </Card>
      </div>
    </>
  );
}
