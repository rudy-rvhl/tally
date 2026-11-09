import Link from "next/link";
import { Plus, Files } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ACCOUNT_TYPE_LABELS } from "@/lib/services/options";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ImportWizard } from "@/components/ImportWizard";
import { formatDate } from "@/lib/engine/dates";

export const metadata = { title: "Import a statement" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const [accounts, categories, recent] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ where: { userId: user.id }, select: { id: true, name: true, parentId: true, kind: true } }),
    prisma.importBatch.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5, include: { account: { select: { name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="Import a statement" subtitle="Drop in a statement from your bank. You'll see everything before it's saved."
        actions={<Link className="btn-secondary" href="/import/bulk"><Files className="h-4 w-4" /> Import several at once</Link>} />
      {!accounts.length ? (
        <Card><EmptyState title="First, add the account this statement is for"
          body="Or drop all your statements at once: we'll recognise each bank account and card and create them for you."
          action={<div className="flex flex-wrap justify-center gap-2"><Link className="btn-primary" href="/import/bulk"><Files className="h-4 w-4" /> Import several statements</Link><Link className="btn-secondary" href="/accounts/new?next=import"><Plus className="h-4 w-4" /> Add an account</Link></div>} /></Card>
      ) : (
        <ImportWizard
          accounts={accounts.map((a) => ({ id: a.id, label: `${a.institution} · ${a.name}${a.mask ? ` ··${a.mask}` : ""}`, type: ACCOUNT_TYPE_LABELS[a.type], currency: a.currency, liability: ["CREDIT_CARD", "BUSINESS_CREDIT_CARD", "LINE_OF_CREDIT"].includes(a.type) }))}
          categories={categories} initialAccount={sp.account} accountant={user.mode === "ACCOUNTANT"}
        />
      )}
      {recent.length > 0 && (
        <Card title="Recent imports" className="mt-6" padded={false}>
          <ul className="divide-y divide-slate-100 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span><span className="font-medium">{r.fileName}</span> <span className="text-slate-500">into {r.account.name}</span></span>
                <span className="text-slate-500">{r.rowsImported} added{r.rowsSkippedDuplicate ? `, ${r.rowsSkippedDuplicate} already there` : ""} · {formatDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
