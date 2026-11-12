import Link from "next/link";
import { Landmark, ShieldCheck, AlertTriangle, CheckCircle2, Unplug } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { plaidConfigured, plaidEnv } from "@/lib/services/plaid";
import { localOnly } from "@/lib/privacy";
import { formatDate } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { Badge, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { ActionForm } from "@/components/ActionForm";
import { ConnectBankButton, SyncNowButton } from "@/components/BankConnect";
import { disconnectBankAction, mapBankAccountAction } from "@/app/actions";

export const metadata = { title: "Bank connections" };

export default async function ConnectionsPage() {
  const user = await requireUser();
  const configured = plaidConfigured();
  const [conns, accounts] = await Promise.all([
    prisma.bankConnection.findMany({ where: { userId: user.id }, include: { accounts: { orderBy: { name: "asc" } } }, orderBy: { createdAt: "asc" } }),
    prisma.account.findMany({ where: { userId: user.id }, orderBy: [{ institution: "asc" }, { name: "asc" }] }),
  ]);
  const active = conns.filter((c) => c.status !== "DISCONNECTED");
  return (
    <>
      <PageHeader back={<BackLink fallback="/accounts" />} title="Bank connections"
        subtitle="Connect your banks once and new transactions come in by themselves, every few hours while LedgerIQ is running."
        actions={configured ? <ConnectBankButton /> : undefined} />

      {localOnly() ? (
        <Card title="Local-only mode is on" subtitle="Nothing leaves this computer, so LedgerIQ doesn't connect to your banks over the internet.">
          <p className="text-sm text-slate-700">Keep importing your statements (Import → several at once): it&apos;s fully private. Connecting a bank means your transactions travel from the bank through Plaid&apos;s servers to this computer, every few hours.</p>
          <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer font-medium text-slate-700">If you decide to allow it</summary>
            <p className="mt-2">In the <code className="rounded bg-slate-100 px-1">.env</code> file, set <code className="rounded bg-slate-100 px-1">LEDGERIQ_LOCAL_ONLY=&quot;false&quot;</code> and add your Plaid keys, then restart LedgerIQ. Even then, LedgerIQ can only reach Plaid&apos;s servers (and Anthropic&apos;s, if you add an AI key), nothing else.</p></details>
          {conns.some((c) => c.status !== "DISCONNECTED") && <p className="mt-3 text-xs text-slate-500">Existing connections are paused. Their transactions stay in LedgerIQ.</p>}
        </Card>
      ) : !configured ? (
        <Card title="Set up bank connections (once)" subtitle="LedgerIQ connects to Canadian banks (Desjardins, Scotiabank, American Express and most others) through Plaid, the service many accounting apps use.">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Create a free account at <a className="link" href="https://dashboard.plaid.com/signup" target="_blank" rel="noreferrer">dashboard.plaid.com</a>, then open <em>Developers → Keys</em>.</li>
            <li>In the LedgerIQ folder, open the <code className="rounded bg-slate-100 px-1">.env</code> file and add:
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`PLAID_CLIENT_ID="your client id"\nPLAID_SECRET="your secret"\nPLAID_ENV="sandbox"`}</pre>
              “sandbox” lets you try it with Plaid&apos;s test bank (user <code>user_good</code>, password <code>pass_good</code>). For your real banks, request Production access in the Plaid dashboard, then use the Production secret and <code>PLAID_ENV=&quot;production&quot;</code>.</li>
            <li>Restart LedgerIQ (Ctrl+C, then <code>npm run dev</code>) and come back here.</li>
          </ol>
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />Your banking password goes only to your bank, in Plaid&apos;s window. LedgerIQ keeps an access token (encrypted) that can read transactions and balances, nothing else. You can disconnect at any time.</p>
        </Card>
      ) : !active.length ? (
        <Card><EmptyState icon={<Landmark className="h-6 w-6" />} title="No bank connected yet"
          body={<>Click <strong>Connect a bank</strong>, choose your bank and sign in. We bring in up to 24 months of history and match each bank account to yours.{plaidEnv() === "sandbox" && <> You&apos;re in <strong>test mode</strong>: use Plaid&apos;s test bank (user_good / pass_good).</>}</>}
          action={<ConnectBankButton />} /></Card>
      ) : null}

      {conns.map((c) => (
        <Card key={c.id} className="mb-6" padded={false} data-testid="bank-connection"
          title={<span className="inline-flex flex-wrap items-center gap-2"><Landmark className="h-4 w-4 text-slate-400" /> {c.institutionName}
            {c.status === "OK" ? <Badge tone="green"><CheckCircle2 className="h-3 w-3" /> Connected</Badge> : c.status === "NEEDS_LOGIN" ? <Badge tone="amber">Sign in again</Badge> : c.status === "ERROR" ? <Badge tone="red">Problem</Badge> : <Badge>Disconnected</Badge>}</span>}
          subtitle={c.lastSyncAt ? `Last updated ${formatDate(c.lastSyncAt, "long")} at ${c.lastSyncAt.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}` : "Not synced yet"}
          action={c.status !== "DISCONNECTED" && <div className="flex flex-wrap items-start gap-2">
            {c.status === "NEEDS_LOGIN" ? <ConnectBankButton connectionId={c.id} label="Sign in again" variant="secondary" /> : <SyncNowButton connectionId={c.id} />}
            <ActionForm action={disconnectBankAction}><input type="hidden" name="id" value={c.id} /><button className="btn-ghost btn-sm text-red-600"><Unplug className="h-3.5 w-3.5" /> Disconnect</button></ActionForm>
          </div>}>
          {c.status === "NEEDS_LOGIN" && <div className="px-5 pt-4"><Notice tone="amber">{c.institutionName} asks you to sign in again before more transactions can come in. Nothing is lost: the missing days come in after you sign in.</Notice></div>}
          {c.status === "ERROR" && c.lastError && <div className="px-5 pt-4"><Notice tone="red"><AlertTriangle className="mr-1 inline h-4 w-4" />{c.lastError}</Notice></div>}
          <ul className="divide-y divide-slate-100">
            {c.accounts.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-4 px-5 py-3" data-testid="bank-feed-account">
                <div className="min-w-[12rem] flex-1">
                  <div className="font-medium">{f.officialName || f.name}{f.mask ? ` ··${f.mask}` : ""}</div>
                  <div className="text-xs text-slate-500">{[f.subtype ?? f.type, f.currency].filter(Boolean).join(" · ")}{f.currentBalanceCents !== null && <> · balance {formatMoney(f.currentBalanceCents, f.currency ?? "CAD")}{f.balanceAt ? ` on ${formatDate(f.balanceAt)}` : ""}</>}</div>
                </div>
                {c.status !== "DISCONNECTED" ? (
                  <ActionForm action={mapBankAccountAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="feedId" value={f.id} />
                    <select name="target" className="input w-64 py-1.5 text-sm" defaultValue={f.accountId ?? ""} aria-label={`Where ${f.name} goes`}>
                      <option value="">Don&apos;t bring in</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.institution} · {a.name}{a.mask ? ` ··${a.mask}` : ""}</option>)}
                      <option value="new">New account</option>
                    </select>
                    <button className="btn-secondary btn-sm">Save</button>
                  </ActionForm>
                ) : <span className="text-sm text-slate-500">{f.accountId ? `Went into ${accounts.find((a) => a.id === f.accountId)?.name ?? "an account"}` : "Not brought in"}</span>}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {configured && <p className="text-xs text-slate-500">Transactions already in LedgerIQ from your imported statements aren&apos;t brought in twice. Statements stay the reference for each month; the connection fills in everything since. {plaidEnv() === "sandbox" ? "Test mode (Plaid sandbox)." : ""} <Link className="link" href="/import">Import statements</Link></p>}
    </>
  );
}
