import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ACCOUNT_TYPE_LABELS } from "@/lib/services/options";
import { PageHeader } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { BulkImport } from "@/components/BulkImport";

export const metadata = { title: "Import several statements" };

export default async function BulkImportPage() {
  const user = await requireUser();
  const accounts = await prisma.account.findMany({ where: { userId: user.id }, orderBy: [{ status: "asc" }, { institution: "asc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader back={<BackLink fallback="/import" />} title="Import several statements"
        subtitle="Drop a whole year of statements from all your banks at once. Each one is filed in the right account by its bank, account number, type of account and dates." />
      <BulkImport typeLabels={ACCOUNT_TYPE_LABELS}
        accounts={accounts.map((a) => ({ id: a.id, label: `${a.institution} · ${a.name}${a.mask ? ` ··${a.mask}` : ""}${a.status === "CLOSED" ? " (closed)" : ""}`, type: a.type, typeLabel: ACCOUNT_TYPE_LABELS[a.type] }))} />
    </>
  );
}
