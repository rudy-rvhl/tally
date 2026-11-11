import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { TenantForm } from "@/components/TenantForm";
import { resolveScope } from "@/lib/scope";

export const metadata = { title: "Add a tenant" };

export default async function NewTenantPage() {
  const user = await requireUser();
  const [scope, accounts] = await Promise.all([resolveScope(user.id), prisma.account.findMany({ where: { userId: user.id, status: "ACTIVE" }, orderBy: { name: "asc" } })]);
  return (
    <>
      <PageHeader back={<BackLink fallback="/reports/rent-roll" />} title="Add a tenant" subtitle="Their rent will be found in your statements automatically from now on, and in the ones you've already imported." />
      <Card className="max-w-3xl"><TenantForm companies={scope.companies} defaultBuilding={scope.building?.id}
        accounts={accounts.map((a) => ({ id: a.id, label: `${a.institution} · ${a.name}${a.mask ? ` ··${a.mask}` : ""}` }))} /></Card>
    </>
  );
}
