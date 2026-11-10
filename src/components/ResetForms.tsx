"use client";
import Link from "next/link";
import { startTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TerminalSquare } from "lucide-react";
import { goTo } from "./navigate";
import { requestResetAction, resetPasswordAction, type ActionState } from "@/app/actions";

const submit = (formAction: (f: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault(); const data = new FormData(e.currentTarget); startTransition(() => formAction(data));
};

export function ForgotForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(requestResetAction, {});
  if (state.ok) return (
    <div className="space-y-4 text-sm" role="status">
      <div className="flex gap-3 rounded-xl bg-brand-50 p-4 text-slate-700">
        <TerminalSquare className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <div>
          <p className="font-semibold text-slate-900">Your reset link is in the Terminal</p>
          <p className="mt-1">If an account uses that email, a one-time link was printed in the Terminal window where LedgerIQ is running (where you typed <code className="rounded bg-white px-1">npm run dev</code>). Copy it into your browser within 30 minutes.</p>
        </div>
      </div>
      <p className="text-slate-500">Nothing printed? The email may be different. In a new Terminal window, in the LedgerIQ folder, run <code className="rounded bg-slate-100 px-1">npm run reset-password</code>: it lists the emails that have accounts and gives you a link.</p>
      <p className="text-center"><Link className="link" href="/login">Back to sign in</Link></p>
    </div>
  );
  return (
    <form className="space-y-4" onSubmit={submit(formAction)}>
      <div>
        <label className="label" htmlFor="email">Email you sign in with</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "One moment…" : "Get a reset link"}</button>
      <p className="text-center text-sm text-slate-500"><Link className="link" href="/login">Back to sign in</Link></p>
    </form>
  );
}

export function NewPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(resetPasswordAction, {});
  const router = useRouter();
  useEffect(() => { if (state.redirectTo) goTo(router, state.redirectTo); }, [state, router]);
  return (
    <form className="space-y-4" onSubmit={submit(formAction)}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} autoComplete="username" />
      <div>
        <label className="label" htmlFor="password">New password</label>
        <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        <p className="mt-1 text-xs text-slate-500">At least 10 characters.</p>
      </div>
      <div>
        <label className="label" htmlFor="confirm">Type it again</label>
        <input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending || !!state.redirectTo}>{pending ? "One moment…" : "Save new password and sign in"}</button>
    </form>
  );
}
