"use client";
import Link from "next/link";
import { startTransition, useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { goTo } from "./navigate";
import type { ActionState } from "@/app/actions";

export function AuthForm({ mode, action }: { mode: "login" | "register"; action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const router = useRouter();
  useEffect(() => { if (state.redirectTo) goTo(router, state.redirectTo); }, [state, router]);
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); startTransition(() => formAction(data)); }}>
      {mode === "register" && (
        <div>
          <label className="label" htmlFor="name">Your name</label>
          <input className="input" id="name" name="name" autoComplete="name" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input className="input" id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 10 : undefined} required />
        {mode === "register" && <p className="mt-1 text-xs text-slate-500">At least 10 characters.</p>}
      </div>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending || !!state.redirectTo}>{pending ? "One moment…" : mode === "login" ? "Sign in" : "Create my account"}</button>
      <p className="text-center text-sm text-slate-500">
        {mode === "login" ? <>New to LedgerIQ? <Link className="link" href="/register">Create an account</Link></> : <>Already have an account? <Link className="link" href="/login">Sign in</Link></>}
      </p>
    </form>
  );
}
