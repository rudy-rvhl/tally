"use client";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { goTo } from "./navigate";
import type { ActionState } from "@/app/actions";

/** Wraps a server action; shows plain-language success or error messages inline and keeps input on errors. */
export function ActionForm({ action, children, className, resetOnSuccess = false, encType }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; encType?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state.redirectTo) goTo(router, state.redirectTo);
    else if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess, router]);
  return (
    <form ref={ref} className={className} encType={encType} aria-busy={pending}
      // Submit manually: React's built-in form actions clear every field when the action finishes,
      // even when it returns an error, which would throw away what the user typed.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {state.error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      {state.ok && state.message && !state.redirectTo && <p role="status" className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>}
    </form>
  );
}

export function SubmitButton({ children, className = "btn-primary" }: { children: React.ReactNode; className?: string }) {
  return <button className={className}>{children}</button>;
}

export function AutoSubmitSelect({ name, defaultValue, children, className, label }: { name: string; defaultValue?: string; children: React.ReactNode; className?: string; label: string }) {
  return <select aria-label={label} name={name} defaultValue={defaultValue} className={className} onChange={(e) => e.currentTarget.form?.requestSubmit()}>{children}</select>;
}
