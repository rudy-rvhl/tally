import Link from "next/link";
import { CheckCircle2, Copy, ArrowLeftRight, Tag, Scale } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/engine/dates";
import { Card, EmptyState, Money, PageHeader, Badge } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { CategoryOptions } from "@/components/CategorySelect";
import { reviewAction, setCategoryAction, rerunMatchingAction } from "@/app/actions";

export const metadata = { title: "Review" };

const SECTIONS = [
  { type: "DUPLICATE", title: "Possible duplicates", icon: Copy, help: "The same purchase may have been imported twice. Confirming a duplicate leaves it out of your totals, but nothing is deleted." },
  { type: "CATEGORY", title: "Choose an expense category", icon: Tag, help: "We weren't sure what these were for. Your answer is remembered for next time." },
  { type: "TRANSFER", title: "Money moving between accounts", icon: ArrowLeftRight, help: "Payments between your own accounts aren't spending. Linking both sides prevents counting them twice." },
  { type: "RECONCILIATION", title: "Statements that don't add up", icon: Scale, help: "The transactions we have don't match the statement's ending balance." },
] as const;

export default async function ReviewPage() {
  const user = await requireUser();
  const items = await prisma.reviewItem.findMany({ where: { userId: user.id, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 300 });
  const ids = [...new Set(items.flatMap((i) => [i.txnId, i.relatedTxnId]).filter(Boolean) as string[])];
  const [txns, categories, resolved] = await Promise.all([
    prisma.transaction.findMany({ where: { id: { in: ids }, userId: user.id }, include: { account: true, merchant: true, category: { include: { parent: true } } } }),
    prisma.category.findMany({ where: { userId: user.id }, select: { id: true, name: true, parentId: true, kind: true } }),
    prisma.reviewItem.count({ where: { userId: user.id, status: { not: "OPEN" } } }),
  ]);
  const byId = new Map(txns.map((t) => [t.id, t]));
  const statements = await prisma.statement.findMany({ where: { id: { in: items.map((i) => i.statementId).filter(Boolean) as string[] } }, select: { id: true, accountId: true } });

  const TxnLine = ({ id }: { id: string | null }) => {
    const t = id ? byId.get(id) : null;
    if (!t) return null;
    return (
      <Link href={`/transactions/${t.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-brand-300">
        <div className="min-w-0">
          <div className="truncate font-medium">{t.merchant?.name ?? t.description}{t.excluded && <Badge tone="red">excluded</Badge>}</div>
          <div className="truncate text-xs text-slate-500">{formatDate(t.date)} · {t.account.name} · <span className="font-mono">{t.originalDescription}</span></div>
        </div>
        <Money cents={t.amountCents} currency={t.currency} colored className="font-semibold" />
      </Link>
    );
  };
  const Btn = ({ item, action, children, primary }: { item: string; action: string; children: React.ReactNode; primary?: boolean }) => (
    <form action={reviewAction}><input type="hidden" name="itemId" value={item} /><input type="hidden" name="action" value={action} /><button className={primary ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{children}</button></form>
  );

  return (
    <>
      <PageHeader title="Transactions to review" subtitle={items.length ? `${items.length} item${items.length === 1 ? "" : "s"} need a quick look. Most take one click.` : "Everything is sorted."}
        actions={<form action={rerunMatchingAction}><button className="btn-secondary">Look for transfers again</button></form>} />
      {!items.length && (
        <Card><EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="You're all caught up" body={resolved ? `You've reviewed ${resolved} item${resolved === 1 ? "" : "s"} so far. New items appear here after each import.` : "When we're unsure about something in an import, we'll ask you here."} action={<Link className="btn-secondary" href="/">Back to overview</Link>} /></Card>
      )}
      <div className="space-y-8">
        {SECTIONS.map((s) => {
          const list = items.filter((i) => i.type === s.type);
          if (!list.length) return null;
          const Icon = s.icon;
          return (
            <section key={s.type}>
              <div className="mb-3 flex items-start gap-3">
                <span className="rounded-xl bg-amber-50 p-2 text-amber-700"><Icon className="h-5 w-5" /></span>
                <div><h2 className="text-lg font-semibold">{s.title} <span className="text-slate-400">({list.length})</span></h2><p className="text-sm text-slate-500">{s.help}</p></div>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {list.map((i) => {
                  const t = i.txnId ? byId.get(i.txnId) : null;
                  return (
                    <div key={i.id} className="card p-4">
                      <p className="mb-3 text-[15px] text-slate-800">{i.message}</p>
                      <div className="space-y-2">
                        <TxnLine id={i.txnId} />
                        {i.relatedTxnId && <TxnLine id={i.relatedTxnId} />}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {i.type === "DUPLICATE" && (<>
                          <Btn item={i.id} action="confirm" primary>Yes, it&apos;s a duplicate</Btn>
                          <Btn item={i.id} action="not_duplicate">Not a duplicate. Keep both</Btn>
                        </>)}
                        {i.type === "TRANSFER" && i.relatedTxnId && (<>
                          <Btn item={i.id} action="confirm" primary>Yes, link them</Btn>
                          <Btn item={i.id} action="reject">No, they&apos;re unrelated</Btn>
                        </>)}
                        {i.type === "TRANSFER" && !i.relatedTxnId && (<>
                          <Link className="btn-primary btn-sm" href={`/import`}>Import the other statement</Link>
                          {t && t.amountCents > 0 && <Btn item={i.id} action="income">It&apos;s money received</Btn>}
                          {t && t.amountCents < 0 && <Btn item={i.id} action="purchase">It&apos;s actually a purchase</Btn>}
                          <Btn item={i.id} action="dismiss">That&apos;s fine, leave it</Btn>
                        </>)}
                        {i.type === "CATEGORY" && t && (
                          <ActionForm action={setCategoryAction} className="flex w-full flex-wrap items-center gap-2">
                            <input type="hidden" name="txnId" value={t.id} />
                            <select name="categoryId" defaultValue={t.categoryId ?? ""} className="input max-w-xs flex-1 py-1.5 text-sm" aria-label="Category"><option value="" disabled>Choose…</option><CategoryOptions categories={categories} /></select>
                            {t.merchantId && <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" name="scope" value="merchant" defaultChecked /> Use for all {t.merchant?.name}</label>}
                            <button className="btn-primary btn-sm">Save</button>
                          </ActionForm>
                        )}
                        {i.type === "CATEGORY" && <Btn item={i.id} action="accept">{t?.category && t.category.name !== "Uncategorized" ? `Looks right: ${t.category.name}` : "Skip for now"}</Btn>}
                        {i.type === "RECONCILIATION" && (<>
                          <Link className="btn-primary btn-sm" href={`/accounts/${statements.find((s2) => s2.id === i.statementId)?.accountId ?? ""}`}>See the statement</Link>
                          <Btn item={i.id} action="dismiss">Dismiss</Btn>
                        </>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
