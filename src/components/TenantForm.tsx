import { ActionForm } from "./ActionForm";
import { saveTenantAction } from "@/app/actions";
import type { CompanyTree } from "@/lib/scope";

export interface TenantValues {
  id?: string; name?: string; unit?: string | null; email?: string | null; phone?: string | null; rentCents?: number; dueDay?: number;
  depositCents?: number | null; buildingId?: string | null; accountId?: string | null; leaseStart?: Date | null; leaseEnd?: Date | null;
  matchText?: string | null; notes?: string | null; status?: "ACTIVE" | "PAST" | "VACANT";
}
const day = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const amt = (c?: number | null) => (c != null ? (c / 100).toFixed(2) : "");

export function TenantForm({ tenant, companies, accounts, defaultBuilding }: { tenant?: TenantValues; companies: CompanyTree[]; accounts: { id: string; label: string }[]; defaultBuilding?: string }) {
  const t = tenant ?? {};
  return (
    <ActionForm action={saveTenantAction} className="grid gap-4 sm:grid-cols-2">
      {t.id && <input type="hidden" name="id" value={t.id} />}
      <div><label className="label" htmlFor="name">Tenant</label><input className="input" id="name" name="name" defaultValue={t.name} placeholder="e.g. Marie Tremblay" required /></div>
      <div className="grid grid-cols-[1fr_8rem] gap-3">
        <div><label className="label" htmlFor="buildingId">Building</label>
          <select className="input" id="buildingId" name="buildingId" defaultValue={t.buildingId ?? defaultBuilding ?? ""}>
            <option value="">No specific building</option>
            {companies.filter((c) => c.buildings.length).map((c) => <optgroup key={c.id} label={c.name}>{c.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>)}
          </select></div>
        <div><label className="label" htmlFor="unit">Unit</label><input className="input" id="unit" name="unit" defaultValue={t.unit ?? ""} placeholder="e.g. 3" /></div>
      </div>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <div><label className="label" htmlFor="rent">Monthly rent</label><input className="input" id="rent" name="rent" inputMode="decimal" defaultValue={amt(t.rentCents)} placeholder="1450.00" required /></div>
        <div><label className="label" htmlFor="dueDay">Due on day</label><input className="input" id="dueDay" name="dueDay" type="number" min={1} max={28} defaultValue={t.dueDay ?? 1} /></div>
      </div>
      <div><label className="label" htmlFor="accountId">Rent is paid into</label>
        <select className="input" id="accountId" name="accountId" defaultValue={t.accountId ?? ""}>
          <option value="">Any of my accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="leaseStart">Lease start</label><input className="input" type="date" id="leaseStart" name="leaseStart" defaultValue={day(t.leaseStart)} /></div>
        <div><label className="label" htmlFor="leaseEnd">Lease end</label><input className="input" type="date" id="leaseEnd" name="leaseEnd" defaultValue={day(t.leaseEnd)} /></div>
      </div>
      <div><label className="label" htmlFor="matchText">How their payment shows on the statement <span className="font-normal text-slate-400">(optional)</span></label>
        <input className="input" id="matchText" name="matchText" defaultValue={t.matchText ?? ""} placeholder="e.g. TREMBLAY, 9123-4567 QUEBEC" />
        <p className="mt-1 text-xs text-slate-500">Words that appear on their deposits, separated by commas. Without them we use their name, then the exact rent amount.</p></div>
      <details className="sm:col-span-2" open={!!(t.email || t.phone || t.depositCents || t.notes)}>
        <summary className="cursor-pointer text-sm font-medium text-slate-600">Contact, deposit and notes</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div><label className="label" htmlFor="email">Email</label><input className="input" type="email" id="email" name="email" defaultValue={t.email ?? ""} /></div>
          <div><label className="label" htmlFor="phone">Phone</label><input className="input" id="phone" name="phone" defaultValue={t.phone ?? ""} /></div>
          <div><label className="label" htmlFor="deposit">Deposit held</label><input className="input" id="deposit" name="deposit" inputMode="decimal" defaultValue={amt(t.depositCents)} placeholder="0.00" /></div>
          <div className="sm:col-span-3"><label className="label" htmlFor="notes">Notes</label><textarea className="input" id="notes" name="notes" rows={2} defaultValue={t.notes ?? ""} /></div>
        </div>
      </details>
      {t.id && <input type="hidden" name="status" value={t.status ?? "ACTIVE"} />}
      <div className="sm:col-span-2"><button className="btn-primary">{t.id ? "Save changes" : "Add tenant"}</button></div>
    </ActionForm>
  );
}
