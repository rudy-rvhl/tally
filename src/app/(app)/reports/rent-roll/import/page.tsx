import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { RentRollImport } from "@/components/RentRollImport";
import { defaultCompany } from "@/lib/scope";

export const metadata = { title: "Import a rent roll" };

export default async function RentRollImportPage() {
  const user = await requireUser();
  await defaultCompany(user.id);
  const accounts = await prisma.account.findMany({ where: { userId: user.id, status: "ACTIVE" }, orderBy: [{ institution: "asc" }, { name: "asc" }] });
  return (
    <>
      <PageHeader back={<BackLink fallback="/reports/rent-roll" />} title="Import a rent roll"
        subtitle="Bring in every tenant at once from your property management software. Import a newer one any time: rents, leases and balances are updated, and tenants who left move to former tenants." />
      <RentRollImport currency={user.baseCurrency} accounts={accounts.map((a) => ({ id: a.id, label: `${a.institution} · ${a.name}${a.mask ? ` ··${a.mask}` : ""}` }))} />
    </>
  );
}
