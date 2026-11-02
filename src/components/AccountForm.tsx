import type { Account } from "@prisma/client";
import { ActionForm } from "./ActionForm";
import { saveAccountAction } from "@/app/actions";
import { ACCOUNT_TYPE_LABELS } from "@/lib/services/options";

const INSTITUTIONS = ["Scotiabank", "RBC Royal Bank", "TD Canada Trust", "BMO", "CIBC", "National Bank", "Desjardins", "American Express", "Tangerine", "Other"];

export function AccountForm({ account, next }: { account?: Account; next?: string }) {
  return (
    <ActionForm action={saveAccountAction} className="grid gap-4 sm:grid-cols-2">
      {account && <input type="hidden" name="id" value={account.id} />}
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <label className="label" htmlFor="institution">Bank or card company</label>
        <input className="input" id="institution" name="institution" list="institutions" defaultValue={account?.institution} placeholder="e.g. Scotiabank" required />
        <datalist id="institutions">{INSTITUTIONS.map((i) => <option key={i} value={i} />)}</datalist>
      </div>
      <div>
        <label className="label" htmlFor="name">A name you&apos;ll recognise</label>
        <input className="input" id="name" name="name" defaultValue={account?.name} placeholder="e.g. Business Visa" required />
      </div>
      <div>
        <label className="label" htmlFor="type">Type of account</label>
        <select className="input" id="type" name="type" defaultValue={account?.type ?? "BUSINESS_CHEQUING"}>
          {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="ownership">Used for</label>
        <select className="input" id="ownership" name="ownership" defaultValue={account?.ownership ?? "BUSINESS"}>
          <option value="BUSINESS">Business</option><option value="PERSONAL">Personal</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="currency">Currency</label>
        <select className="input" id="currency" name="currency" defaultValue={account?.currency ?? "CAD"}>
          <option value="CAD">Canadian dollars (CAD)</option><option value="USD">US dollars (USD)</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="mask">Last 4 digits <span className="font-normal text-slate-400">(optional)</span></label>
        <input className="input" id="mask" name="mask" inputMode="numeric" maxLength={4} defaultValue={account?.mask ?? ""} placeholder="1234" />
        <p className="mt-1 text-xs text-slate-500">Helps us check you&apos;re importing into the right account. We never store full numbers.</p>
      </div>
      <details className="sm:col-span-2" open={!!account?.openingBalanceCents}>
        <summary className="cursor-pointer text-sm font-medium text-slate-600">Starting balance (optional)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="openingBalance">Balance (amount owed, for cards)</label>
            <input className="input" id="openingBalance" name="openingBalance" inputMode="decimal" defaultValue={account?.openingBalanceCents != null ? (account.openingBalanceCents / 100).toFixed(2) : ""} placeholder="0.00" />
          </div>
          <div>
            <label className="label" htmlFor="openingBalanceDate">On this date</label>
            <input className="input" type="date" id="openingBalanceDate" name="openingBalanceDate" defaultValue={account?.openingBalanceDate?.toISOString().slice(0, 10) ?? ""} />
          </div>
        </div>
      </details>
      {account && (
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select className="input" id="status" name="status" defaultValue={account.status}><option value="ACTIVE">Active</option><option value="CLOSED">Closed</option></select>
        </div>
      )}
      <div className="sm:col-span-2"><button className="btn-primary">{account ? "Save changes" : next === "import" ? "Add account and import a statement" : "Add account"}</button></div>
    </ActionForm>
  );
}
