import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { AccountForm } from "@/components/AccountForm";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Add account" };

export default async function NewAccount({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser();
  const sp = await searchParams;
  return (
    <>
      <PageHeader back={<BackLink fallback="/accounts" />} title="Add an account" subtitle="A bank account, credit card, line of credit or cash box." />
      <Card className="max-w-3xl"><AccountForm next={sp.next} /></Card>
    </>
  );
}
