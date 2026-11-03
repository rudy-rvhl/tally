"use client";
import { useTransition } from "react";

/**
 * A form that runs a server action from its own submit handler.
 *
 * Why not `<form action={serverAction}>`? React hydrates forms whose action is a server
 * reference through a special path; in this app (Next.js 15.5) that intermittently failed
 * hydration (React error #418) on about 1% of page loads. Submitting through onSubmit avoids
 * that path entirely. The pressed button's name/value is still included, like a native submit.
 */
export function ServerActionForm({ action, children, className }: {
  action: (formData: FormData) => void | Promise<void>; children: React.ReactNode; className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <form className={className} aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        start(async () => { await action(data); });
      }}>
      {children}
    </form>
  );
}
