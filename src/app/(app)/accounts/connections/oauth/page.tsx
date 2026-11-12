import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { OAuthResume } from "@/components/BankConnect";

export const metadata = { title: "Connecting your bank" };

export default async function OAuthReturn() {
  await requireUser();
  return (<><PageHeader title="Connecting your bank" /><Card><OAuthResume /></Card></>);
}
