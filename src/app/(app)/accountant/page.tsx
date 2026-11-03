import Link from "next/link";
import clsx from "clsx";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { latestMonth } from "@/lib/services/query";
import { monthLabel, monthRange, formatDate } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { isLiability, KIND_LABELS } from "@/lib/engine/classify";
import { Card, EmptyState, PageHeader, Badge } from "@/components/ui";
import { MonthPicker } from "@/components/MonthPicker";
import { ReconciliationCard } from "@/components/ReconciliationCard";
import { ActionForm } from "@/components/ActionForm";
import { journalAction, saveStatementAction, setModeAction, updateCategoryAction } from "@/app/actions";
import { ServerActionForm } from "@/components/ServerActionForm";

export const metadata = { title: "Accountant View" };
const TABS = [["reconciliation", "Reconciliation"], ["journal", "Journal & trial balance"], ["chart", "Chart of accounts & tax"], ["audit", "Audit log"]] as const;
const MOVE = new Set(["TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT", "ADJUSTMENT"]);

export default async function AccountantPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  if (user.mode !== "ACCOUNTANT") {
    return (
      <Card><EmptyState title="Accountant View is turned off" body="It adds reconciliation tools, journal entries, the chart of accounts, tax treatment and the full audit log. It uses the same numbers as the simple view."
        action={<ServerActionForm action={setModeAction}><input type="hidden" name="mode" value="ACCOUNTANT" /><button className="btn-primary">Turn on Accountant View</button></ServerActionForm>} /></Card>
    );
  }
  const tab = TABS.find(([t]) => t === sp.tab)?.[0] ?? "reconciliation";
  return (
    <>
      <PageHeader title="Accountant View" subtitle="Formal accounting tools. Every figure comes from the same ledger as the simple view." />
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {TABS.map(([t, l]) => <Link key={t} href={`/accountant?tab=${t}`} className={clsx("whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold", tab === t ? "bg-white shadow-sm" : "text-slate-600")}>{l}</Link>)}
      </div>
      {tab === "reconciliation" && <Reconciliation userId={user.id} />}
      {tab === "journal" && <Journal userId={user.id} month={sp.month ?? (await latestMonth(user.id))} />}
      {tab === "chart" && <Chart userId={user.id} />}
      {tab === "audit" && <Audit userId={user.id} />}
    </>
  );
}

async function Reconciliation({ userId }: { userId: string }) {
  const accounts = await prisma.account.findMany({ where: { userId }, include: { statements: { orderBy: { periodEnd: "desc" } } }, orderBy: { name: "asc" } });
  const [unmatched, pending] = await Promise.all([
    prisma.reviewItem.count({ where: { userId, status: "OPEN", type: "TRANSFER" } }),
    prisma.transaction.count({ where: { userId, status: "PENDING", excluded: false } }),
  ]);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="text-sm text-slate-500">Statements reconciled</div><div className="text-2xl font-bold">{accounts.flatMap((a) => a.statements).filter((s) => s.status === "BALANCED").length} / {accounts.flatMap((a) => a.statements).length}</div></div>
        <Link href="/review" className="card p-4 hover:border-brand-200"><div className="text-sm text-slate-500">Unmatched transfers</div><div className="text-2xl font-bold">{unmatched}</div></Link>
        <Link href="/transactions?q=" className="card p-4"><div className="text-sm text-slate-500">Pending (excluded from reconciliation)</div><div className="text-2xl font-bold">{pending}</div></Link>
      </div>
      {accounts.map((a) => (
        <Card key={a.id} title={`${a.institution} · ${a.name}`} subtitle={`${isLiability(a.type) ? "Liability: balances are amounts owed" : "Asset"} · ${a.currency}`}>
          <div className="space-y-3">{a.statements.map((s) => <ReconciliationCard key={s.id} userId={userId} statementId={s.id} accountant />)}</div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-brand-700">Add statement period</summary>
            <ActionForm action={saveStatementAction} className="mt-3 grid gap-2 sm:grid-cols-5">
              <input type="hidden" name="accountId" value={a.id} />
              <input className="input" type="date" name="periodStart" aria-label="Start" required />
              <input className="input" type="date" name="periodEnd" aria-label="End" required />
              <input className="input" name="opening" placeholder="Opening" aria-label="Opening balance" required />
              <input className="input" name="closing" placeholder="Closing" aria-label="Closing balance" required />
              <button className="btn-secondary">Reconcile</button>
            </ActionForm>
          </details>
        </Card>
      ))}
    </div>
  );
}

async function Journal({ userId, month }: { userId: string; month: string }) {
  const r = monthRange(month);
  const [txns, manual, ledger] = await Promise.all([
    prisma.transaction.findMany({ where: { userId, excluded: false, date: { gte: r.start, lte: r.end } }, include: { account: true, category: true, splits: { include: { category: true } } }, orderBy: { date: "asc" } }),
    prisma.journalEntry.findMany({ where: { userId, date: { gte: r.start, lte: r.end } }, include: { lines: true }, orderBy: { date: "asc" } }),
    prisma.ledgerAccount.findMany({ where: { userId }, orderBy: { code: "asc" } }),
  ]);
  type Line = { date: Date; ref: string; href?: string; code: string; dr: number; cr: number; memo: string; currency: string };
  const lines: Line[] = [];
  for (const t of txns) {
    const bank = isLiability(t.account.type) ? "2100" : "1000";
    const parts = t.splits.length ? t.splits.map((s) => ({ code: s.category.ledgerCode ?? "5900", amt: s.amountCents })) : [{ code: MOVE.has(t.kind) ? (t.kind === "LOAN_PAYMENT" ? "2200" : "1900") : t.kind === "INCOME" ? "4000" : t.category?.ledgerCode ?? "5900", amt: t.amountCents }];
    const memo = `${KIND_LABELS[t.kind].accountant}: ${t.description}`;
    for (const p of parts) {
      if (p.amt < 0) { lines.push({ date: t.date, ref: t.id, href: `/transactions/${t.id}`, code: p.code, dr: -p.amt, cr: 0, memo, currency: t.currency }); lines.push({ date: t.date, ref: t.id, href: `/transactions/${t.id}`, code: bank, dr: 0, cr: -p.amt, memo, currency: t.currency }); }
      else { lines.push({ date: t.date, ref: t.id, href: `/transactions/${t.id}`, code: bank, dr: p.amt, cr: 0, memo, currency: t.currency }); lines.push({ date: t.date, ref: t.id, href: `/transactions/${t.id}`, code: p.code, dr: 0, cr: p.amt, memo, currency: t.currency }); }
    }
  }
  for (const e of manual) for (const l of e.lines) lines.push({ date: e.date, ref: e.id, code: l.ledgerCode, dr: l.debitCents, cr: l.creditCents, memo: `Manual: ${e.memo}`, currency: "CAD" });
  const currencies = [...new Set(lines.map((l) => l.currency))];
  const name = (code: string) => ledger.find((l) => l.code === code)?.name ?? code;
  return (
    <div className="space-y-6">
      <div className="flex justify-end"><MonthPicker month={month} basePath="/accountant" extra="&tab=journal" /></div>
      {currencies.map((cur) => {
        const ls = lines.filter((l) => l.currency === cur);
        const tb = new Map<string, { dr: number; cr: number }>();
        for (const l of ls) { const x = tb.get(l.code) ?? { dr: 0, cr: 0 }; x.dr += l.dr; x.cr += l.cr; tb.set(l.code, x); }
        const totDr = ls.reduce((s, l) => s + l.dr, 0), totCr = ls.reduce((s, l) => s + l.cr, 0);
        return (
          <Card key={cur} title={`Trial balance, ${monthLabel(month)} (${cur})`} subtitle={totDr === totCr ? "Debits equal credits." : "Out of balance!"} padded={false}>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100"><tr><th className="th">Account</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th><th className="th text-right">Net</th></tr></thead>
              <tbody className="divide-y divide-slate-100 num">
                {[...tb].sort().map(([code, v]) => <tr key={code}><td className="td">{code} · {name(code)}</td><td className="td text-right">{formatMoney(v.dr, cur)}</td><td className="td text-right">{formatMoney(v.cr, cur)}</td><td className="td text-right">{formatMoney(v.dr - v.cr, cur)}</td></tr>)}
                <tr className="font-semibold"><td className="td">Total</td><td className="td text-right">{formatMoney(totDr, cur)}</td><td className="td text-right">{formatMoney(totCr, cur)}</td><td className="td text-right">{formatMoney(totDr - totCr, cur)}</td></tr>
              </tbody>
            </table>
          </Card>
        );
      })}
      <Card title="General journal" padded={false}>
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="sticky top-0 bg-slate-50"><tr><th className="th">Date</th><th className="th">Account</th><th className="th">Memo</th><th className="th text-right">Debit</th><th className="th text-right">Credit</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => (
                <tr key={i}><td className="td whitespace-nowrap">{formatDate(l.date)}</td><td className="td whitespace-nowrap">{l.code} · {name(l.code)}</td><td className="td max-w-xs truncate">{l.href ? <Link className="hover:underline" href={l.href}>{l.memo}</Link> : l.memo}</td><td className="td text-right num">{l.dr ? formatMoney(l.dr, l.currency) : ""}</td><td className="td text-right num">{l.cr ? formatMoney(l.cr, l.currency) : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Post a manual journal entry" subtitle="For accruals, reclassifications or splitting loan interest from principal. Debits must equal credits.">
        <ActionForm action={journalAction} resetOnSuccess>
          <div className="mb-2 grid gap-2 sm:grid-cols-[10rem_1fr]">
            <input type="date" name="date" className="input" required aria-label="Date" />
            <input name="memo" className="input" placeholder="Memo, e.g. Interest portion of October loan payment" aria-label="Memo" />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_7rem_7rem] gap-2">
              <select name="code" className="input py-2" aria-label="Ledger account"><option value="">Account…</option>{ledger.map((l) => <option key={l.code} value={l.code}>{l.code} · {l.name}</option>)}</select>
              <input name="debit" className="input py-2 text-right" placeholder="Debit" inputMode="decimal" aria-label="Debit" />
              <input name="credit" className="input py-2 text-right" placeholder="Credit" inputMode="decimal" aria-label="Credit" />
            </div>
          ))}
          <button className="btn-secondary">Post entry</button>
        </ActionForm>
      </Card>
    </div>
  );
}

async function Chart({ userId }: { userId: string }) {
  const [ledger, cats] = await Promise.all([
    prisma.ledgerAccount.findMany({ where: { userId }, orderBy: { code: "asc" } }),
    prisma.category.findMany({ where: { userId }, include: { parent: true }, orderBy: [{ parentId: "asc" }, { name: "asc" }] }),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <Card title="Ledger accounts" padded={false}>
        <ul className="divide-y divide-slate-100 text-sm">{ledger.map((l) => <li key={l.id} className="flex justify-between px-5 py-2"><span><span className="font-mono text-slate-500">{l.code}</span> {l.name}</span><Badge>{l.type.toLowerCase()}</Badge></li>)}</ul>
      </Card>
      <Card title="Category mapping and tax treatment" subtitle="Each expense category posts to a ledger account. Tax treatment is the default for its transactions." padded={false}>
        <div className="max-h-[40rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50"><tr><th className="th">Category</th><th className="th">Name, bank-book # · ledger code · tax treatment</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {cats.map((c) => (
                <tr key={c.id}><td className="td">{c.parent ? <span className="text-slate-400">{c.parent.name} › </span> : null}<span className="font-medium">{c.name}</span></td>
                  <td className="td">
                    <ActionForm action={updateCategoryAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={c.id} />
                      <input name="name" defaultValue={c.name} className="input w-40 py-1.5 text-xs" aria-label="Category name" />
                      <input name="bookCode" defaultValue={c.bookCode ?? ""} className="input w-20 py-1.5 text-xs" placeholder="#" aria-label="Bank book code" title="Code in the # column of the Excel bank book" />
                      <select name="ledgerCode" defaultValue={c.ledgerCode ?? ""} className="input w-44 py-1.5 text-xs" aria-label="Ledger code"><option value="">—</option>{ledger.map((l) => <option key={l.code} value={l.code}>{l.code} {l.name}</option>)}</select>
                      <input name="taxTreatment" defaultValue={c.taxTreatment ?? ""} className="input w-56 py-1.5 text-xs" placeholder="e.g. 50% deductible" aria-label="Tax treatment" />
                      <button className="btn-ghost btn-sm">Save</button>
                    </ActionForm>
                  </td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

async function Audit({ userId }: { userId: string }) {
  const logs = await prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 250 });
  return (
    <Card title="Audit log" subtitle="Every change to financial data, with before and after values. Entries can't be edited." padded={false}>
      <div className="max-h-[40rem] overflow-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="sticky top-0 bg-slate-50"><tr><th className="th">When</th><th className="th">Action</th><th className="th">Record</th><th className="th">Before → After</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="td whitespace-nowrap text-slate-500">{l.createdAt.toLocaleString("en-CA")}</td>
                <td className="td font-medium">{l.action}</td>
                <td className="td">{l.entityType === "Transaction" ? <Link className="link" href={`/transactions/${l.entityId}`}>{l.entityType}</Link> : l.entityType} <span className="font-mono text-xs text-slate-400">{l.entityId.slice(-8)}</span></td>
                <td className="td"><code className="block max-w-md overflow-x-auto whitespace-pre text-[11px] text-slate-600">{l.before ? JSON.stringify(l.before) : "—"}{"\n→ "}{l.after ? JSON.stringify(l.after) : "—"}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
