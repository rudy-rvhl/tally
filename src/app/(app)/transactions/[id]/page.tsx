import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Paperclip, ArrowLeftRight, History, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { KIND_LABELS } from "@/lib/engine/classify";
import { ACCOUNT_TYPE_LABELS } from "@/lib/services/options";
import { Badge, Card, Money, Notice, PageHeader } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { ActionForm } from "@/components/ActionForm";
import { CategoryOptions } from "@/components/CategorySelect";
import { excludeAction, receiptAction, restoreAction, setCategoryAction, setDetailsAction, setKindAction, setMerchantAction, setTxnBuildingAction, splitAction, unlinkTransferAction } from "@/app/actions";
import { companyTree } from "@/lib/scope";
import { ServerActionForm } from "@/components/ServerActionForm";

const SOURCE_LABEL: Record<string, string> = { USER: "You chose this", RULE: "From one of your rules", HISTORY: "Based on how you categorised this supplier before", MERCHANT: "Suggested for this supplier", PATTERN: "Suggested from the description", AI: "Suggested by AI", NONE: "Not categorised yet" };

export default async function TxnDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const t = await prisma.transaction.findFirst({
    where: { id, userId: user.id },
    include: { account: true, merchant: true, category: { include: { parent: true } }, importBatch: true, receipts: { select: { id: true, fileName: true, sizeBytes: true, createdAt: true } }, splits: { include: { category: { include: { parent: true } } } } },
  });
  if (!t) notFound();
  const accountant = user.mode === "ACCOUNTANT";
  const [categories, history, reviews, linked, ledger, companies] = await Promise.all([
    prisma.category.findMany({ where: { userId: user.id }, select: { id: true, name: true, parentId: true, kind: true } }),
    prisma.auditLog.findMany({ where: { userId: user.id, entityType: "Transaction", entityId: t.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.reviewItem.findMany({ where: { userId: user.id, status: "OPEN", OR: [{ txnId: t.id }, { relatedTxnId: t.id }] } }),
    t.transferGroupId ? prisma.transaction.findMany({ where: { userId: user.id, transferGroupId: t.transferGroupId, id: { not: t.id } }, include: { account: true } }) : Promise.resolve([]),
    accountant ? prisma.ledgerAccount.findMany({ where: { userId: user.id } }) : Promise.resolve([]),
    companyTree(user.id),
  ]);
  const allBuildings = companies.flatMap((c) => c.buildings.map((b) => ({ ...b, company: c.name })));
  const accountBuilding = allBuildings.find((b) => b.id === t.account.buildingId);
  const accountCompany = companies.find((c) => c.id === t.account.companyId);
  const catLabel = t.category ? (t.category.parent ? `${t.category.parent.name} › ${t.category.name}` : t.category.name) : "Uncategorized";
  const spendish = ["PURCHASE", "FEE", "INTEREST", "REFUND", "REVERSAL"].includes(t.kind);
  const kinds = Object.entries(KIND_LABELS) as [keyof typeof KIND_LABELS, { simple: string; accountant: string }][];
  const liability = ["CREDIT_CARD", "BUSINESS_CREDIT_CARD", "LINE_OF_CREDIT"].includes(t.account.type);
  const bankCode = liability ? "2100" : "1000";
  const otherCode = MOVE.has(t.kind) ? "1900" : t.kind === "INCOME" ? "4000" : t.category?.ledgerCode ?? "5900";
  const ledgerName = (code: string) => ledger.find((l) => l.code === code)?.name ?? code;

  return (
    <>
      <PageHeader back={<BackLink fallback="/transactions" />} title={t.merchant?.name ?? t.description}
        subtitle={<>{formatDate(t.date, "long")} · {t.account.institution} {t.account.name}{t.account.mask ? ` ··${t.account.mask}` : ""}</>}
        actions={<div className="text-right"><Money cents={t.amountCents} currency={t.currency} colored className="text-3xl font-bold" /><div className="text-xs text-slate-500">{t.amountCents < 0 ? "Money out" : "Money in"} · {t.currency}</div></div>} />

      {t.excluded && (
        <div className="mb-4"><Notice tone="red" action={<ServerActionForm action={restoreAction}><input type="hidden" name="txnId" value={t.id} /><button className="btn-secondary btn-sm">Restore it</button></ServerActionForm>}>
          This transaction is excluded from all totals ({t.excludedReason ?? "marked as a duplicate"}). It's kept for your records and can be restored at any time.
        </Notice></div>
      )}
      {reviews.map((r) => <div key={r.id} className="mb-4"><Notice tone="amber" action={<Link href="/review" className="btn-secondary btn-sm">Go to Review</Link>}>{r.message}</Notice></div>)}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="What was this for?" subtitle={spendish ? SOURCE_LABEL[t.categorySource] : "This isn't spending, so it doesn't need an expense category."}>
            <div className="grid gap-5 sm:grid-cols-2">
              <ActionForm action={setCategoryAction}>
                <input type="hidden" name="txnId" value={t.id} />
                <label className="label" htmlFor="categoryId">Expense category</label>
                <select id="categoryId" name="categoryId" defaultValue={t.categoryId ?? ""} className="input"><option value="" disabled>Choose a category</option><CategoryOptions categories={categories} /></select>
                <fieldset className="mt-3 space-y-1.5 text-sm text-slate-700">
                  <legend className="sr-only">Apply to</legend>
                  <label className="flex items-center gap-2"><input type="radio" name="scope" value="this" defaultChecked={!t.merchantId} /> Just this transaction</label>
                  {t.merchantId && <label className="flex items-center gap-2"><input type="radio" name="scope" value="merchant" defaultChecked /> All {t.merchant?.name} purchases I haven&apos;t reviewed</label>}
                  {t.merchantId && <label className="flex items-center gap-2"><input type="radio" name="scope" value="rule" /> Always, as a rule for future imports</label>}
                </fieldset>
                <button className="btn-primary btn-sm mt-3">Save category</button>
                <p className="mt-2 text-xs text-slate-500">Currently: <strong>{catLabel}</strong>{!t.categoryConfirmed && t.categoryConfidence > 0 ? ` (${Math.round(t.categoryConfidence * 100)}% sure)` : ""}</p>
              </ActionForm>
              <ActionForm action={setKindAction}>
                <input type="hidden" name="txnId" value={t.id} />
                <label className="label" htmlFor="kind">Type of transaction</label>
                <select id="kind" name="kind" defaultValue={t.kind} className="input">
                  {kinds.map(([k, l]) => <option key={k} value={k}>{accountant ? l.accountant : l.simple}</option>)}
                </select>
                <button className="btn-secondary btn-sm mt-3">Save type</button>
                <p className="mt-2 text-xs text-slate-500">{MOVE.has(t.kind) ? "Not counted as spending or income, so nothing is counted twice." : t.kind === "INCOME" ? "Counted as money received." : "Counted as money spent."}{!t.kindConfirmed && " We detected this automatically."}</p>
              </ActionForm>
            </div>
          </Card>

          <Card title="Details">
            <div className="grid gap-5 sm:grid-cols-2">
              <ActionForm action={setMerchantAction}>
                <input type="hidden" name="txnId" value={t.id} />
                <label className="label" htmlFor="merchant">Supplier</label>
                <input id="merchant" name="merchant" className="input" defaultValue={t.merchant?.name ?? ""} placeholder="Who was this paid to?" />
                <button className="btn-secondary btn-sm mt-2">Change supplier</button>
                <p className="mt-1 text-xs text-slate-500">Future statements with the same wording will use this supplier.</p>
              </ActionForm>
              <ActionForm action={setDetailsAction}>
                <input type="hidden" name="txnId" value={t.id} />
                <label className="label" htmlFor="description">Description</label>
                <input id="description" name="description" className="input" defaultValue={t.description} />
                <label className="label mt-3" htmlFor="notes">Notes</label>
                <textarea id="notes" name="notes" className="input" rows={2} defaultValue={t.notes ?? ""} placeholder="e.g. Laptop for new hire" />
                {accountant && (<><label className="label mt-3" htmlFor="taxCode">Tax treatment</label>
                  <select id="taxCode" name="taxCode" className="input" defaultValue={t.taxCode ?? ""}>
                    <option value="">Use category default ({t.category?.taxTreatment ?? "not set"})</option>
                    <option>GST/HST: input tax credit eligible</option><option>QST: input tax refund eligible</option><option>Exempt / zero-rated</option>
                    <option>50% deductible (meals &amp; entertainment)</option><option>Not deductible</option><option>Capital asset (CCA)</option>
                  </select></>)}
                <button className="btn-secondary btn-sm mt-2">Save details</button>
              </ActionForm>
            </div>
            {allBuildings.length > 0 && (
              <ActionForm action={setTxnBuildingAction} className="mt-6 border-t border-slate-100 pt-5">
                <input type="hidden" name="txnId" value={t.id} />
                <label className="label" htmlFor="buildingId">Building</label>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                  <select id="buildingId" name="buildingId" className="input" defaultValue={t.buildingId ?? ""}>
                    <option value="">{accountBuilding ? `Same as the account: ${accountBuilding.name}` : `Not a specific building (${accountCompany?.name ?? "company"})`}</option>
                    {companies.filter((c) => c.buildings.length).map((c) => (
                      <optgroup key={c.id} label={c.name}>{c.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
                    ))}
                  </select>
                  <button className="btn-secondary btn-sm">Save building</button>
                </div>
                {t.merchantId && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    <label className="flex items-center gap-1.5"><input type="radio" name="scope" value="this" defaultChecked /> Just this one</label>
                    <label className="flex items-center gap-1.5"><input type="radio" name="scope" value="supplier" /> All {t.merchant?.name} transactions on this account</label>
                  </div>
                )}
              </ActionForm>
            )}
            <dl className="mt-6 grid gap-x-6 gap-y-3 border-t border-slate-100 pt-5 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Wording on the statement</dt><dd className="font-mono text-xs text-slate-800">{t.originalDescription}</dd></div>
              <div><dt className="text-slate-500">Account</dt><dd><Link className="link" href={`/accounts/${t.accountId}`}>{t.account.institution} · {t.account.name}</Link> <span className="text-slate-500">({ACCOUNT_TYPE_LABELS[t.account.type]}, {t.account.ownership === "BUSINESS" ? "business" : "personal"})</span></dd></div>
              <div><dt className="text-slate-500">Status</dt><dd>{t.status === "PENDING" ? <Badge tone="amber">Pending</Badge> : "Posted"}</dd></div>
              <div><dt className="text-slate-500">Came from</dt><dd>{t.importBatch ? <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5 text-slate-400" /><a className="link" href={`/api/imports/${t.importBatch.id}/file`}>{t.importBatch.fileName}</a> <span className="text-slate-400">imported {formatDate(t.importBatch.createdAt)}</span></span> : "Added in LedgerIQ"}</dd></div>
              {t.merchantId && <div><dt className="text-slate-500">Supplier history</dt><dd><Link className="link" href={`/spending/suppliers/${t.merchantId}`}>All {t.merchant?.name} purchases</Link></dd></div>}
              {accountant && <div><dt className="text-slate-500">Reference / fingerprint</dt><dd className="font-mono text-xs text-slate-600">{t.externalId ?? t.fingerprint.slice(0, 18)}</dd></div>}
            </dl>
          </Card>

          {linked.length > 0 && (
            <Card title={<span className="inline-flex items-center gap-2"><ArrowLeftRight className="h-4 w-4" /> Other side of this transfer</span>} subtitle="Both sides are linked, so this money isn't counted as spending or income.">
              {linked.map((l) => (
                <Link key={l.id} href={`/transactions/${l.id}`} className="flex items-center justify-between rounded-lg p-2 hover:bg-slate-50">
                  <span>{formatDate(l.date)} · {l.account.name} · {l.description}</span><Money cents={l.amountCents} currency={l.currency} colored />
                </Link>
              ))}
              <ServerActionForm action={unlinkTransferAction} className="mt-2"><input type="hidden" name="groupId" value={t.transferGroupId!} /><button className="btn-ghost btn-sm">These aren&apos;t the same money. Unlink them</button></ServerActionForm>
            </Card>
          )}

          {accountant && (
            <Card title="Split across categories" subtitle="For a purchase that covers several things, e.g. a Costco run with office supplies and groceries. Parts must add up exactly.">
              <ActionForm action={splitAction}>
                <input type="hidden" name="txnId" value={t.id} />
                <div className="space-y-2">
                  {[...t.splits.map((s) => ({ categoryId: s.categoryId, amount: (Math.abs(s.amountCents) / 100).toFixed(2), memo: s.memo ?? "" })), { categoryId: "", amount: "", memo: "" }, { categoryId: "", amount: "", memo: "" }].map((s, i) => (
                    <div key={i} className="grid grid-cols-[1fr_7rem] gap-2 sm:grid-cols-[1fr_7rem_1fr]">
                      <select name="splitCategory" defaultValue={s.categoryId} className="input py-2" aria-label="Split category"><option value="">Category…</option><CategoryOptions categories={categories} /></select>
                      <input name="splitAmount" defaultValue={s.amount} className="input py-2 text-right" inputMode="decimal" placeholder="0.00" aria-label="Split amount" />
                      <input name="splitMemo" defaultValue={s.memo} className="input col-span-2 py-2 sm:col-span-1" placeholder="Memo (optional)" aria-label="Split memo" />
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">Total to allocate: {formatMoney(Math.abs(t.amountCents), t.currency)}. Leave all rows empty and save to remove the split.</p>
                <button className="btn-secondary btn-sm mt-2">Save split</button>
              </ActionForm>
            </Card>
          )}

          {accountant && (
            <Card title="Journal view" subtitle="How this transaction posts to the general ledger (double-entry).">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-1">Account</th><th className="py-1 text-right">Debit</th><th className="py-1 text-right">Credit</th></tr></thead>
                <tbody className="num">
                  {(t.amountCents < 0
                    ? [[otherCode, -t.amountCents, 0], [bankCode, 0, -t.amountCents]]
                    : [[bankCode, t.amountCents, 0], [otherCode, 0, t.amountCents]]).map(([code, dr, cr]) => (
                    <tr key={String(code)} className="border-t border-slate-100"><td className="py-1.5">{code} · {ledgerName(String(code))}</td><td className="text-right">{dr ? formatMoney(Number(dr), t.currency) : ""}</td><td className="text-right">{cr ? formatMoney(Number(cr), t.currency) : ""}</td></tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title={<span className="inline-flex items-center gap-2"><Paperclip className="h-4 w-4" /> Receipt or invoice</span>}>
            {t.receipts.length > 0 && (
              <ul className="mb-3 space-y-1 text-sm">
                {t.receipts.map((r) => <li key={r.id}><a className="link" href={`/api/receipts/${r.id}`} target="_blank" rel="noreferrer">{r.fileName}</a> <span className="text-xs text-slate-400">{Math.round(r.sizeBytes / 1024)} KB</span></li>)}
              </ul>
            )}
            <ActionForm action={receiptAction} resetOnSuccess>
              <input type="hidden" name="txnId" value={t.id} />
              <input type="file" name="receipt" accept="application/pdf,image/*" className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700" aria-label="Receipt file" />
              <button className="btn-secondary btn-sm mt-3">Attach</button>
            </ActionForm>
            <p className="mt-2 flex items-center gap-1 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> Stored encrypted.</p>
          </Card>

          {!t.excluded && (
            <Card title="Is this a duplicate?">
              <p className="mb-3 text-sm text-slate-600">If this purchase appears twice, mark this copy as a duplicate. It&apos;ll be left out of every total but kept for your records, so you can undo it later.</p>
              <ServerActionForm action={excludeAction}><input type="hidden" name="txnId" value={t.id} /><input type="hidden" name="reason" value="Marked as a duplicate" /><button className="btn-danger btn-sm">Mark as duplicate</button></ServerActionForm>
            </Card>
          )}

          <Card title={<span className="inline-flex items-center gap-2"><History className="h-4 w-4" /> Change history</span>} subtitle="Every change is recorded.">
            {history.length ? (
              <ol className="space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                    <div className="font-medium text-slate-800">{ACTION_LABEL[h.action] ?? h.action}</div>
                    <div className="text-xs text-slate-500">{h.createdAt.toLocaleString("en-CA")}</div>
                    {accountant && <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-[11px] text-slate-600">{JSON.stringify({ before: h.before, after: h.after })}</pre>}
                  </li>
                ))}
                <li className="border-l-2 border-slate-200 pl-3"><div className="font-medium text-slate-800">Imported</div><div className="text-xs text-slate-500">{t.createdAt.toLocaleString("en-CA")}</div></li>
              </ol>
            ) : <p className="text-sm text-slate-500">Imported {t.createdAt.toLocaleString("en-CA")}. No changes since.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

const MOVE = new Set(["TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT", "ADJUSTMENT"]);
const ACTION_LABEL: Record<string, string> = {
  "category.set": "Category changed", "category.reclassify": "Category updated from a similar transaction", "kind.set": "Type changed", "details.set": "Details edited",
  exclude: "Marked as a duplicate", restore: "Restored", "merchant.set": "Supplier changed", "split.set": "Split saved", "split.clear": "Split removed",
  "receipt.add": "Receipt attached", "transfer.link": "Linked to matching transfer", "transfer.unlink": "Transfer unlinked", "transfer.confirm": "Confirmed as a transfer",
  "reconciliation.adjustment": "Balance correction created",
};
