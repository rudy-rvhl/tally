import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { ReportsTabs } from "@/components/Nav";
import { SupplierCheck } from "@/components/SupplierCheck";

export const metadata = { title: "Supplier check" };

export default async function SupplierCheckPage() {
  const user = await requireUser();
  return (
    <>
      <ReportsTabs />
      <PageHeader title="Supplier check" subtitle="Does a supplier's statement match your bank? Upload what they sent you: every payment on it is looked for in your accounts, payments they missed are listed, and their math is checked." />
      <SupplierCheck currency={user.baseCurrency} />
    </>
  );
}
