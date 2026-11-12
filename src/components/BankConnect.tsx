"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2, RefreshCw, KeyRound } from "lucide-react";
import clsx from "clsx";
import { syncBankAction } from "@/app/actions";

type PlaidHandler = { open: () => void; destroy?: () => void };
declare global { interface Window { Plaid?: { create: (o: Record<string, unknown>) => PlaidHandler } } }

const SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
function loadPlaid(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT; s.async = true; s.onload = () => resolve(); s.onerror = () => reject(new Error("Couldn't load the bank sign-in window. Check the internet connection."));
    document.head.appendChild(s);
  });
}

async function openLink(opts: { connectionId?: string; receivedRedirectUri?: string; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  let token = opts.receivedRedirectUri ? localStorage.getItem("liq_link_token") : null;
  if (!token) {
    const res = await fetch("/api/bank/link-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: opts.connectionId, language: navigator.language.startsWith("fr") ? "fr" : "en" }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    token = body.linkToken as string;
    try { localStorage.setItem("liq_link_token", token); } catch { /* private window: OAuth return won't resume, Link still works */ }
  }
  await loadPlaid();
  const handler = window.Plaid!.create({
    token, ...(opts.receivedRedirectUri ? { receivedRedirectUri: opts.receivedRedirectUri } : {}),
    onSuccess: async (publicToken: string) => {
      if (opts.connectionId) { opts.onDone("Signed in again. Syncing…"); return; } // update mode: same connection, nothing to exchange
      const res = await fetch("/api/bank/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicToken }) });
      const body = await res.json();
      if (!res.ok) opts.onError(body.error); else opts.onDone(`Connected. ${body.sync?.added ?? 0} transactions brought in.`);
    },
    onExit: (err: { display_message?: string; error_message?: string } | null) => { if (err) opts.onError(err.display_message || err.error_message || "The bank sign-in was closed."); else opts.onError(""); },
  });
  handler.open();
}

/** "Connect a bank" / "Sign in again" button. */
export function ConnectBankButton({ connectionId, label = "Connect a bank", variant = "primary" }: { connectionId?: string; label?: string; variant?: "primary" | "secondary" }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const router = useRouter();
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button type="button" className={variant === "primary" ? "btn-primary" : "btn-secondary btn-sm"} disabled={busy} data-testid={connectionId ? "bank-relogin" : "bank-connect"}
        onClick={async () => {
          setBusy(true); setMsg("");
          try {
            await openLink({ connectionId, onDone: async (m) => { setMsg(m); if (connectionId) await syncBankAction(connectionId); router.refresh(); setBusy(false); }, onError: (m) => { setMsg(m); setBusy(false); } });
          } catch (e) { setMsg((e as Error).message); setBusy(false); }
        }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : connectionId ? <KeyRound className="h-4 w-4" /> : <Link2 className="h-4 w-4" />} {label}
      </button>
      {msg && <span className="text-xs text-slate-600" role="status">{msg}</span>}
    </div>
  );
}

/** Banks that sign you in on their own site send you back here; Link resumes where it left off. */
export function OAuthResume() {
  const router = useRouter();
  const [msg, setMsg] = useState("Finishing the connection with your bank…");
  useEffect(() => {
    openLink({ receivedRedirectUri: window.location.href, onDone: (m) => { setMsg(m); router.replace("/accounts/connections"); }, onError: (m) => { setMsg(m || "The bank sign-in was closed."); } })
      .catch((e) => setMsg((e as Error).message));
  }, [router]);
  return <p className="text-sm text-slate-600" role="status">{msg}</p>;
}

export function SyncNowButton({ connectionId }: { connectionId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn-secondary btn-sm" disabled={pending} data-testid="bank-sync"
        onClick={() => start(async () => { const r = await syncBankAction(connectionId); setMsg("error" in r && r.error ? r.error : `${(r as { added: number }).added} new, ${(r as { updated: number }).updated} updated${(r as { removed: number }).removed ? `, ${(r as { removed: number }).removed} removed by the bank` : ""}`); })}>
        <RefreshCw className={clsx("h-3.5 w-3.5", pending && "animate-spin")} /> Sync now
      </button>
      {msg && <span className="text-xs text-slate-600" role="status" data-testid="bank-sync-result">{msg}</span>}
    </span>
  );
}
