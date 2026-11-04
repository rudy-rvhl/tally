"use client";
import { useTransition } from "react";

/**
 * A form that runs a server action from its own submit handler, with a pending state.
 * The pressed button's name/value is included, like a native submit.
 *
 * Note: this was introduced while investigating an intermittent hydration error (React #418,
 * a few page loads in 1,000). Controlled measurements later showed it did not change that
 * error rate, so it is not a fix for it; it is kept because it works and is tested.
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
