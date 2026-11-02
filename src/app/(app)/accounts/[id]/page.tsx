import Link from "next/link";
import { notFound } from "next/navigation";
import { Upload, FileText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { accountCoverage, ACCOUNT_TYPE_LABELS, lastNMonths } from "@/lib/services/options";
import { latestMonth, loadAnalytic, txnInclude } from "@/lib/services/query";
import { accountBalance } from "@/lib/services/balances";
import { summarize } from "@/lib/engine/analytics";
import { formatDate, monthLabel } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { Card, PageHeader, Stat } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { TxnTable } from "@/components/TxnTable";
import { AccountForm } from "@/components/AccountForm";
import { ReconciliationCard } from "@/components/ReconciliationCard";
import { ActionForm } from "@/components/ActionForm";
import { saveStatementAction } from "@/app/actions";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const a = await prisma.account.findFirst({ where: { id, userId: user.id }, include: { imports: { orderBy: { createdAt: "desc" } }, statements: { orderBy: { periodEnd: "desc" } } } });
  if (!a) notFound();
  const latest = await latestMonth(user.id);
  const [bal, cov, recent, month] = await Promise.all([
    accountBalance(a),
    accountCoverage(user.id, lastNMonths(latest, 12)),
    prisma.transaction.findMany({ where: { accountId: a.id, userId: user.id }, include: txnInclude, orderBy: { date: "desc" }, take: 15 }),
    loadAnalytic(user, { account: a.id, month: latest }),
  ]);
  const s = summarize(month.txns);
  const cells = cov.find((c) => c.accountId === a.id)?.cells ?? [];
  const accountant = user.mode === "ACCOUNTANT";
  return (
    <>
      <PageHeader back={<BackLink fallback="/accounts" />} title={a.name} subtitle={`${a.institution}${a.mask ? ` ··${a.mask}` : ""} · ${ACCOUNT_TYPE_LABELS[a.type]} · ${a.currency} · ${a.ownership === "BUSINESS" ? "Business" : "Personal"}`}
        actions={<><Link className="btn-secondary" href={`/transactions?account=${a.id}`}>All transactions</Link><Link className="btn-primary" href={`/import?account=${a.id}`}><Upload className="h-4 w-4" /> Import statement</Link></>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={bal?.owed ? "Amount owed" : "Balance"} value={bal ? formatMoney(bal.cents, a.currency) : "Unknown"} hint={bal ? `As of ${formatDate(bal.asOf)}, from the last ${bal.basis}` : "Add a statement balance below"} />
        <Stat label={`Spent in ${monthLabel(latest)}`} value={formatMoney(s.spendingCents, user.baseCurrency)} href={`/transactions?account=${a.id}&month=${latest}&kind=spending`} />
        <Stat label={`Received in ${monthLabel(latest)}`} value={formatMoney(s.incomeCents, user.baseCurrency)} href={`/transactions?account=${a.id}&month=${latest}&kind=income`} />
        <Stat label="Statements imported" value={a.imports.length} />
      </div>

      <Card title="Months imported" className="mb-6">
        <div className="flex flex-wrap gap-2">
          {cells.map((c) => (
            <Link key={c.month} href={c.status === "MISSING" ? `/import?account=${a.id}` : `/transactions?account=${a.id}&month=${c.month}`}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${c.status === "COMPLETE" ? "bg-emerald-50 text-emerald-800" : c.status === "PARTIAL" ? "bg-amber-50 text-amber-800" : "border border-dashed border-slate-300 text-slate-500 hover:border-brand-400"}`}>
              {monthLabel(c.month, "short")} {c.status === "COMPLETE" ? "✓" : c.status === "PARTIAL" ? `${c.coveredDays}/${c.daysInMonth} days` : "missing"}
            </Link>
          ))}
        </div>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="Does it match your statement?" subtitle="We check that the starting balance plus everything we imported equals the statement's ending balance.">
          <div className="space-y-3">
            {a.statements.length ? a.statements.slice(0, 6).map((st) => <ReconciliationCard key={st.id} userId={user.id} statementId={st.id} accountant={accountant} />)
              : <p className="text-sm text-slate-500">No statement balances yet. Add them below (they&apos;re printed on every statement), or import an OFX/PDF statement that includes them.</p>}
          </div>
          <details className="mt-4" open={!a.statements.length}>
            <summary className="cursor-pointer text-sm font-medium text-brand-700">Add statement balances</summary>
            <ActionForm action={saveStatementAction} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="accountId" value={a.id} />
              <div><label className="label" htmlFor="ps">Statement start</label><input className="input" type="date" id="ps" name="periodStart" required /></div>
              <div><label className="label" htmlFor="pe">Statement end</label><input className="input" type="date" id="pe" name="periodEnd" required /></div>
              <div><label className="label" htmlFor="ob">{bal?.owed ?? ["CREDIT_CARD", "BUSINESS_CREDIT_CARD", "LINE_OF_CREDIT"].includes(a.type) ? "Previous balance owed" : "Opening balance"}</label><input className="input" id="ob" name="opening" inputMode="decimal" required /></div>
              <div><label className="label" htmlFor="cb">{["CREDIT_CARD", "BUSINESS_CREDIT_CARD", "LINE_OF_CREDIT"].includes(a.type) ? "New balance owed" : "Closing balance"}</label><input className="input" id="cb" name="closing" inputMode="decimal" required /></div>
              <div className="sm:col-span-2"><button className="btn-secondary">Check this statement</button></div>
            </ActionForm>
          </details>
        </Card>
        <Card title="Imported statements" padded={false}>
          <ul className="divide-y divide-slate-100">
            {a.imports.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <a className="block truncate font-medium text-slate-800 hover:text-brand-700" href={`/api/imports/${i.id}/file`}>{i.fileName}</a>
                  <div className="text-xs text-slate-500">{i.periodStart && i.periodEnd ? `${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}` : "Period unknown"} · imported {formatDate(i.createdAt)}</div>
                </div>
                <div className="text-right text-xs text-slate-500"><div className="font-semibold text-slate-800">{i.rowsImported} added</div>{i.rowsSkippedDuplicate > 0 && <div>{i.rowsSkippedDuplicate} already there</div>}</div>
              </li>
            ))}
            {!a.imports.length && <li className="px-5 py-6 text-sm text-slate-500">Nothing imported yet.</li>}
          </ul>
        </Card>
      </div>

      <Card title="Latest transactions" padded={false} className="mb-6" action={<Link className="link text-sm" href={`/transactions?account=${a.id}`}>See all</Link>}>
        <TxnTable rows={recent} accountant={accountant} showAccount={false} />
      </Card>

      <Card title="Account details"><AccountForm account={a} /></Card>
    </>
  );
}
