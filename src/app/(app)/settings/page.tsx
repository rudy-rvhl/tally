import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { CategoryOptions } from "@/components/CategorySelect";
import { addCategoryAction, addCompanyAction, addRuleAction, combineMerchantsAction, deleteBuildingAction, deleteCompanyAction, deleteRuleAction, renameCompanyAction, saveBuildingAction, saveCompanyAction, saveRateAction, setBaseCurrencyAction, setModeAction } from "@/app/actions";
import { defaultCompany } from "@/lib/scope";
import { aiEnabled } from "@/lib/services/ai";
import { monthKey } from "@/lib/engine/dates";
import { ServerActionForm } from "@/components/ServerActionForm";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  await defaultCompany(user.id);
  const [categories, rules, rates, merchants, foreign, companies] = await Promise.all([
    prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, include: { _count: { select: { transactions: true } } } }),
    prisma.categoryRule.findMany({ where: { userId: user.id }, include: { category: { include: { parent: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.exchangeRate.findMany({ where: { userId: user.id }, orderBy: [{ month: "desc" }] }),
    prisma.merchant.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, include: { _count: { select: { transactions: true } } } }),
    prisma.transaction.findMany({ where: { userId: user.id, currency: { not: user.baseCurrency } }, select: { date: true, currency: true }, distinct: ["currency", "date"] }),
    prisma.company.findMany({
      where: { userId: user.id }, orderBy: [{ createdAt: "asc" }, { name: "asc" }],
      include: { _count: { select: { accounts: true } }, buildings: { orderBy: { name: "asc" }, include: { _count: { select: { accounts: true, transactions: true } } } } },
    }),
  ]);
  const neededRates = [...new Set(foreign.map((t) => `${t.currency}|${monthKey(t.date)}`))].filter((k) => !rates.some((r) => `${r.currency}|${r.month}` === k)).sort();
  const parents = categories.filter((c) => !c.parentId);
  const accountant = user.mode === "ACCOUNTANT";
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="How LedgerIQ looks" subtitle="Both views use exactly the same numbers.">
          <ServerActionForm action={setModeAction} className="grid gap-3 sm:grid-cols-2">
            {[["SIMPLE", "Simple", "Everyday language. Recommended for business owners."], ["ACCOUNTANT", "Accountant", "Adds reconciliation tools, journal entries, splits, tax treatment and the audit log."]].map(([v, l, d]) => (
              <button key={v} name="mode" value={v} className={`rounded-xl border p-4 text-left transition ${user.mode === v ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 hover:border-slate-300"}`}>
                <div className="font-semibold">{l} {user.mode === v && <Badge tone="blue">On</Badge>}</div>
                <div className="mt-1 text-sm text-slate-600">{d}</div>
              </button>
            ))}
          </ServerActionForm>
          <ServerActionForm action={setBaseCurrencyAction} className="mt-5 flex items-end gap-2">
            <div className="flex-1"><label className="label" htmlFor="bc">Report everything in</label>
              <select id="bc" name="currency" defaultValue={user.baseCurrency} className="input"><option value="CAD">Canadian dollars (CAD)</option><option value="USD">US dollars (USD)</option></select></div>
            <button className="btn-secondary">Save</button>
          </ServerActionForm>
          <p className="mt-4 text-sm text-slate-500">AI help with questions: {aiEnabled() ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>} {aiEnabled() ? "AI only interprets your question. All amounts are calculated from your data." : "Questions are understood with built-in rules. Set ANTHROPIC_API_KEY on the server to enable AI interpretation."}</p>
        </Card>

        <Card title="Companies & buildings" subtitle="Each company's name is printed on its pages of the bank book. Buildings keep each property's money separate on screen; the bank book download always includes everything." className="lg:col-span-2">
          <div id="company" />
          <div className="space-y-4">
            {companies.map((co) => (
              <div key={co.id} className="rounded-xl border border-slate-200 p-4" data-testid="company">
                <div className="flex flex-wrap items-start gap-2">
                  <ActionForm action={renameCompanyAction} className="flex min-w-0 flex-1 items-end gap-2">
                    <input type="hidden" name="id" value={co.id} />
                    <div className="min-w-0 flex-1"><label className="label" htmlFor={`co-${co.id}`}>Company name</label><input id={`co-${co.id}`} name="name" className="input font-semibold" defaultValue={co.name} required /></div>
                    <button className="btn-secondary">Save</button>
                  </ActionForm>
                  {companies.length > 1 && !co._count.accounts && !co.buildings.length && (
                    <ActionForm action={deleteCompanyAction} className="self-end"><input type="hidden" name="id" value={co.id} /><button className="btn-ghost text-red-600">Remove</button></ActionForm>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">{co._count.accounts} account{co._count.accounts === 1 ? "" : "s"} · {co.buildings.length} building{co.buildings.length === 1 ? "" : "s"}</p>
                <ul className="mt-3 space-y-2">
                  {co.buildings.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
                      <ActionForm action={saveBuildingAction} className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <input type="hidden" name="id" value={b.id} />
                        <input name="name" className="input" defaultValue={b.name} aria-label="Building name" required />
                        <input name="address" className="input" defaultValue={b.address ?? ""} aria-label="Address" placeholder="Address (optional)" />
                        <button className="btn-secondary btn-sm">Save</button>
                      </ActionForm>
                      {!b._count.accounts && !b._count.transactions
                        ? <ActionForm action={deleteBuildingAction}><input type="hidden" name="id" value={b.id} /><button className="btn-ghost btn-sm text-red-600">Remove</button></ActionForm>
                        : <span className="pb-1 text-xs text-slate-500">{b._count.accounts} account{b._count.accounts === 1 ? "" : "s"}{b._count.transactions ? ` · ${b._count.transactions} assigned` : ""}</span>}
                    </li>
                  ))}
                </ul>
                <ActionForm action={saveBuildingAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" resetOnSuccess>
                  <input type="hidden" name="companyId" value={co.id} />
                  <input name="name" className="input" placeholder="New building, e.g. 123 Main St" aria-label={`New building for ${co.name}`} required />
                  <input name="address" className="input" placeholder="Address (optional)" aria-label="Address" />
                  <button className="btn-secondary">Add building</button>
                </ActionForm>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
            <ActionForm action={addCompanyAction} className="flex flex-wrap items-end gap-2" resetOnSuccess>
              <div className="min-w-[12rem] flex-1"><label className="label" htmlFor="newCompany">Add another company</label><input id="newCompany" name="name" className="input" placeholder="e.g. Example Properties Inc." required /></div>
              <button className="btn-secondary">Add company</button>
            </ActionForm>
            <ActionForm action={saveCompanyAction} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1"><label className="label" htmlFor="fy">Fiscal year starts in</label>
                <select id="fy" name="fiscalYearStartMonth" className="input" defaultValue={user.fiscalYearStartMonth}>
                  {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select></div>
              <button className="btn-secondary">Save</button>
            </ActionForm>
          </div>
          <p className="mt-3 text-xs text-slate-500">To put a bank account or card in a company or building, edit the account. If one card is used for several buildings, leave its building empty and choose the building on each transaction.</p>
        </Card>

        <Card title="Exchange rates" subtitle={`Amounts in other currencies are converted to ${user.baseCurrency} only with a rate you enter. Without one, they're left out of totals and we tell you.`}>
          <div id="rates" />
          {neededRates.length > 0 && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Needed: {neededRates.map((k) => k.replace("|", " for ")).join(", ")}</p>}
          <ActionForm action={saveRateAction} className="grid grid-cols-2 gap-2 sm:grid-cols-4" resetOnSuccess>
            <select name="currency" className="input" aria-label="Currency">{["USD", "CAD"].filter((x) => x !== user.baseCurrency).map((x) => <option key={x}>{x}</option>)}</select>
            <input name="month" type="month" className="input" aria-label="Month" defaultValue={neededRates[0]?.split("|")[1]} required />
            <input name="rate" className="input" inputMode="decimal" placeholder={`1 = ? ${user.baseCurrency}`} aria-label="Rate" required />
            <button className="btn-secondary">Save rate</button>
            <input name="source" className="input col-span-2 sm:col-span-4" placeholder="Source (e.g. Bank of Canada monthly average)" aria-label="Source" />
          </ActionForm>
          {rates.length > 0 && <table className="mt-4 w-full text-sm"><tbody className="divide-y divide-slate-100">{rates.map((r) => <tr key={r.id}><td className="py-1.5">{r.month}</td><td>1 {r.currency} = <span className="num font-medium">{r.rate}</span> {user.baseCurrency}</td><td className="text-xs text-slate-500">{r.source}</td></tr>)}</tbody></table>}
        </Card>

        <Card title="Combine supplier names" subtitle="If one business shows up under several names, combine them. Transactions are moved, never changed or deleted.">
          <div id="suppliers" />
          <ActionForm action={combineMerchantsAction}>
            <label className="label" htmlFor="into">Keep this name</label>
            <select id="into" name="into" className="input mb-3" required>{merchants.map((m) => <option key={m.id} value={m.id}>{m.name} ({m._count.transactions})</option>)}</select>
            <p className="label">…and fold these into it</p>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 text-sm">
              {merchants.map((m) => <label key={m.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50"><input type="checkbox" name="from" value={m.id} /> {m.name} <span className="text-xs text-slate-400">{m._count.transactions}</span></label>)}
              {!merchants.length && <p className="p-2 text-slate-500">Suppliers appear after your first import.</p>}
            </div>
            <button className="btn-secondary mt-3">Combine</button>
          </ActionForm>
        </Card>

        <Card title="Automatic categories" subtitle="Rules run on every import. Your own choices always win over our suggestions.">
          <ActionForm action={addRuleAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" resetOnSuccess>
            <input name="pattern" className="input" placeholder='When it mentions… e.g. "Uber"' aria-label="Words to match" required />
            <select name="categoryId" className="input" aria-label="Category" required><option value="">Choose a category</option><CategoryOptions categories={categories} /></select>
            <button className="btn-secondary">Add rule</button>
          </ActionForm>
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span>“{r.pattern}” → <strong>{r.category.parent ? `${r.category.parent.name} › ` : ""}{r.category.name}</strong> {r.createdFrom === "CORRECTION" && <Badge>from your correction</Badge>}</span>
                <ServerActionForm action={deleteRuleAction}><input type="hidden" name="id" value={r.id} /><button className="btn-ghost btn-sm text-red-600">Remove</button></ServerActionForm>
              </li>
            ))}
            {!rules.length && <li className="py-2 text-slate-500">No rules yet. They&apos;re also created when you choose “Always” while fixing a category.</li>}
          </ul>
        </Card>

        <Card title="Categories" subtitle="Add your own categories and subcategories. A supplier can have purchases in many categories." className="lg:col-span-2">
          <ActionForm action={addCategoryAction} className="mb-5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" resetOnSuccess>
            <input name="name" className="input" placeholder="New category name" aria-label="Category name" required />
            <select name="parentId" className="input" aria-label="Inside"><option value="">As a main category</option>{parents.map((p) => <option key={p.id} value={p.id}>Inside {p.name}</option>)}</select>
            <button className="btn-secondary">Add category</button>
          </ActionForm>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {parents.map((p) => (
              <div key={p.id}>
                <div className="font-semibold">{p.name} {p.kind === "NON_OPERATING" && <Badge>not spending</Badge>}{p.kind === "INCOME" && <Badge tone="green">income</Badge>} {accountant && p.ledgerCode && <span className="text-xs text-slate-400">{p.ledgerCode}</span>}</div>
                <ul className="mt-1 text-sm text-slate-600">{categories.filter((c) => c.parentId === p.id).map((c) => <li key={c.id}>{c.name} <span className="text-xs text-slate-400">{c._count.transactions || ""}</span></li>)}</ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
