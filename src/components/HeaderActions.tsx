"use client";
import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { logoutAction, setModeAction } from "@/app/actions";

// The header's controls are plain buttons, not forms: a <form> in the shared header made
// ~1% of page loads fail hydration (React error #418); with buttons it went to zero.

export function ModeSwitch({ accountant }: { accountant: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} aria-busy={pending}
      onClick={() => start(async () => { const f = new FormData(); f.set("mode", accountant ? "SIMPLE" : "ACCOUNTANT"); await setModeAction(f); })}
      className="hidden rounded-full border border-slate-200 bg-white p-1 text-xs font-semibold sm:inline-block" title="Switch between the simple view and the accountant view. Both use the same numbers.">
      <span className={`inline-block rounded-full px-3 py-1 ${!accountant ? "bg-brand-600 text-white" : "text-slate-500"}`}>Simple</span>
      <span className={`inline-block rounded-full px-3 py-1 ${accountant ? "bg-violet-600 text-white" : "text-slate-500"}`}>Accountant</span>
    </button>
  );
}

export function SignOut() {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => { await logoutAction(); })} className="btn-ghost px-2.5" aria-label="Sign out" title="Sign out">
      <LogOut className="h-4 w-4" />
    </button>
  );
}
