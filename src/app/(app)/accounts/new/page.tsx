import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { AccountForm } from "@/components/AccountForm";
import { BackLink } from "@/components/BackLink";
import { defaultCompany, resolveScope, scopeValue } from "@/lib/scope";

export const metadata = { title: "Add account" };

export default async function NewAccount({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  await defaultCompany(user.id);
  // New accounts start in whatever company or building is being viewed.
  const scope = await resolveScope(user.id);
  return (
    <>
      <PageHeader back={<BackLink fallback="/accounts" />} title="Add an account" subtitle="A bank account, credit card, line of credit or cash box." />
      <Card className="max-w-3xl"><AccountForm next={sp.next} companies={scope.companies} defaultPlacement={scope.scope.type === "all" ? undefined : scopeValue(scope.scope)} /></Card>
    </>
  );
}
