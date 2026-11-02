import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { registerAction } from "@/app/actions";
import { currentUser } from "@/lib/auth";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await currentUser()) redirect("/");
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">Create your account</h1>
      <p className="mb-6 text-sm text-slate-500">It takes a minute. No accounting knowledge needed.</p>
      <AuthForm mode="register" action={registerAction} />
    </>
  );
}
