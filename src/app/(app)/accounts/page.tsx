import Link from "next/link";
import { Plus, Upload, CheckCircle2, AlertTriangle, CreditCard, Landmark, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { accountCoverage, ACCOUNT_TYPE_LABELS, lastNMonths } from "@/lib/services/options";
import { latestMonth } from "@/lib/services/query";
import { accountBalance } from "@/lib/services/balances";
import { formatMoney } from "@/lib/engine/money";
import { formatDate, monthLabel } from "@/lib/engine/dates";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { isLiability } from "@/lib/engine/classify";

export const metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const accounts = await prisma.account.findMany({
    where: { userId: user.id }, orderBy: [{ status: "asc" }, { ownership: "asc" }, { name: "asc" }],
    include: { _count: { select: { transactions: true } }, imports: { orderBy: { createdAt: "desc" }, take: 1 }, statements: { orderBy: { periodEnd: "desc" }, take: 1 } },
  });
  if (!accounts.length) {
    return (
      <>
        <PageHeader title="Accounts" subtitle="Your bank accounts and credit cards" />
        {sp.welcome && <div className="mb-4"><Notice tone="green">Your account is ready. Add the first bank account or card you want to track.</Notice></div>}
        <Card><EmptyState icon={<Landmark className="h-6 w-6" />} title="Add your first account" body="Add each bank account and credit card your business uses. You can add as many as you like." action={<Link className="btn-primary" href="/accounts/new?next=import"><Plus className="h-4 w-4" /> Add an account</Link>} /></Card>
      </>
    );
  }
  const latest = await latestMonth(user.id);
  const months = lastNMonths(latest, 12);
  const [cov, balances] = await Promise.all([accountCoverage(user.id, months), Promise.all(accounts.map((a) => accountBalance(a)))]);
  const missing = cov.flatMap((a) => a.cells.filter((c) => c.status === "MISSING").map((c) => ({ ...c, name: a.name })));
  const groups = [["BUSINESS", "Business"], ["PERSONAL", "Personal"]] as const;

  return (
    <>
      <PageHeader title="Accounts" subtitle="Every bank account and card, and which statements you've imported." actions={<>
        <Link className="btn-secondary" href="/accounts/new"><Plus className="h-4 w-4" /> Add account</Link>
        <Link className="btn-primary" href="/import"><Upload className="h-4 w-4" /> Import a statement</Link>
      </>} />

      {groups.map(([own, label]) => {
        const list = accounts.filter((a) => a.ownership === own);
        if (!list.length) return null;
        return (
          <section key={own} className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{label}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((a) => {
                const b = balances[accounts.indexOf(a)];
                const Icon = isLiability(a.type) ? CreditCard : a.type === "CASH" ? Wallet : Landmark;
                const st = a.statements[0];
                return (
                  <Link key={a.id} href={`/accounts/${a.id}`} className={`card group block p-5 transition hover:border-brand-200 hover:shadow-md ${a.status === "CLOSED" ? "opacity-60" : ""}`}>
                    <div className="flex items-start gap-3">
                      <span className="rounded-xl bg-slate-100 p-2.5 text-slate-600 group-hover:bg-brand-50 group-hover:text-brand-600"><Icon className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-900">{a.name}</div>
                        <div className="text-sm text-slate-500">{a.institution}{a.mask ? ` ··${a.mask}` : ""} · {ACCOUNT_TYPE_LABELS[a.type]}</div>
                      </div>
                      {a.currency !== "CAD" && <Badge tone="blue">{a.currency}</Badge>}
                    </div>
                    <div className="mt-4">
                      {b ? (<>
                        <div className="text-xs text-slate-500">{b.owed ? "Amount owed" : "Balance"} as of {formatDate(b.asOf)}</div>
                        <div className="num text-2xl font-bold">{formatMoney(b.cents, a.currency)}</div>
                      </>) : <div className="text-sm text-slate-500">Balance unknown. Add a statement balance to track it.</div>}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{a._count.transactions} transactions</span>
                      {a.imports[0] && <span>· last import {formatDate(a.imports[0].createdAt)}</span>}
                      {st && (st.status === "BALANCED" ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Statement balances</Badge> : st.status === "DIFFERENCE" ? <Badge tone="amber"><AlertTriangle className="h-3 w-3" /> Off by {formatMoney(Math.abs(st.differenceCents ?? 0), a.currency)}</Badge> : null)}
                      {a.status === "CLOSED" && <Badge>Closed</Badge>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      <Card title="Which months have been imported?" subtitle="A full square means we have the whole month. Gaps mean a statement is missing, so totals for that month will be too low." padded={false}>
        <div className="overflow-x-auto p-5">
          <table className="text-sm">
            <thead><tr><th className="pr-4 text-left text-xs font-medium text-slate-500">Account</th>{months.map((m) => <th key={m} className="px-1 text-center text-xs font-medium text-slate-500">{monthLabel(m, "short").replace(" ", " ")}</th>)}</tr></thead>
            <tbody>
              {cov.map((a) => (
                <tr key={a.accountId}>
                  <td className="whitespace-nowrap py-1 pr-4 font-medium text-slate-700"><Link className="hover:text-brand-700" href={`/accounts/${a.accountId}`}>{a.name}</Link></td>
                  {a.cells.map((c) => (
                    <td key={c.month} className="p-1 text-center">
                      <Link href={c.status === "COMPLETE" ? `/transactions?account=${a.accountId}&month=${c.month}` : `/import?account=${a.accountId}`}
                        title={`${monthLabel(c.month)}: ${c.status === "COMPLETE" ? "complete" : c.status === "PARTIAL" ? `${c.coveredDays} of ${c.daysInMonth} days` : "missing. Click to import"}`}
                        className={`mx-auto block h-7 w-7 rounded-md ${c.status === "COMPLETE" ? "bg-emerald-500" : c.status === "PARTIAL" ? "bg-gradient-to-r from-emerald-400 to-slate-100" : "border-2 border-dashed border-slate-300 bg-white hover:border-brand-400"}`}>
                        <span className="sr-only">{c.status}</span>
                      </Link>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500" /> Complete</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-gradient-to-r from-emerald-400 to-slate-100" /> Part of the month</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border-2 border-dashed border-slate-300" /> Missing (click to import)</span>
          </div>
          {missing.length > 0 && <p className="mt-3 text-sm text-amber-700">{missing.length} account-month{missing.length === 1 ? " is" : "s are"} missing in the last 12 months.</p>}
        </div>
      </Card>
    </>
  );
}
