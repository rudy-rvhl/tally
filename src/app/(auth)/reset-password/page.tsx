import Link from "next/link";
import { checkResetToken } from "@/lib/services/passwordReset";
import { NewPasswordForm } from "@/components/ResetForms";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { token = "" } = await searchParams;
  const user = await checkResetToken(token);
  if (!user) return (
    <>
      <h1 className="mb-1 text-xl font-bold">This link doesn&apos;t work any more</h1>
      <p className="mb-6 text-sm text-slate-500">Reset links last 30 minutes and work once. Ask for a new one; nothing in your data has changed.</p>
      <Link className="btn-primary w-full" href="/forgot-password">Get a new link</Link>
    </>
  );
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">Choose a new password</h1>
      <p className="mb-6 text-sm text-slate-500">For <strong className="text-slate-700">{user.email}</strong>. Only your password changes; all your data stays.</p>
      <NewPasswordForm token={token} email={user.email} />
    </>
  );
}
