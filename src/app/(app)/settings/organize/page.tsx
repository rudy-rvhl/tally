import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { OrganizeForm } from "@/components/OrganizeForm";
import { companyTree } from "@/lib/scope";
import { companyKey } from "@/lib/engine/organize";

export const metadata = { title: "Organize" };

export default async function OrganizePage() {
  const user = await requireUser();
  const companies = await companyTree(user.id);
  // Start from what's there now: one line per company, its number, its buildings.
  const initial = companies.map((c) => `${c.name}: ${/^\d+$/.test(companyKey(c.name)) ? companyKey(c.name) : ""} | ${c.buildings.map((b) => b.name).join(", ")}`).join("\n");
  return (
    <>
      <PageHeader back={<BackLink fallback="/settings#company" />} title="Organize companies, buildings and accounts"
        subtitle="Describe how your businesses are set up. We put every account in its company and building, and every transaction in its building where we can tell. You'll see all the changes before anything is saved." />
      <OrganizeForm initial={initial} />
    </>
  );
}
