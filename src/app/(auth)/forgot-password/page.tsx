import { ForgotForm } from "@/components/ResetForms";

export const metadata = { title: "Forgot your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">Forgot your password?</h1>
      <p className="mb-6 text-sm text-slate-500">Set a new one. Your accounts, statements and transactions stay exactly as they are.</p>
      <ForgotForm />
    </>
  );
}
