"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, X, SlidersHorizontal } from "lucide-react";

export interface FilterOptions {
  months: { value: string; label: string }[];
  accounts: { id: string; label: string }[];
  categories: { id: string; label: string; depth: number }[];
  merchants?: { id: string; label: string }[];
  institutions: string[];
  currencies: string[];
  accountant: boolean;
  show?: ("month" | "range" | "account" | "category" | "kind" | "ownership" | "currency" | "institution" | "merchant" | "q")[];
}

const KIND_OPTIONS_SIMPLE = [
  { value: "", label: "Everything" }, { value: "spending", label: "Money spent" }, { value: "income", label: "Money received" },
  { value: "movement", label: "Moved between my accounts" }, { value: "REFUND", label: "Refunds" },
];
const KIND_OPTIONS_ACCT = [
  ...KIND_OPTIONS_SIMPLE, { value: "PURCHASE", label: "Expenses only" }, { value: "FEE", label: "Bank charges" }, { value: "INTEREST", label: "Interest expense" },
  { value: "CARD_PAYMENT", label: "Card payments" }, { value: "LOAN_PAYMENT", label: "Loan repayments" }, { value: "TRANSFER", label: "Transfers" }, { value: "ADJUSTMENT", label: "Adjustments" },
];

export function FilterBar({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const show = new Set(options.show ?? ["month", "account", "category", "kind", "ownership", "q"]);

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    p.delete("page");
    start(() => router.push(`${path}${p.toString() ? `?${p}` : ""}`, { scroll: false }));
  };
  const active = ["month", "from", "to", "account", "category", "kind", "ownership", "currency", "institution", "merchant", "q", "accountType"].filter((k) => sp.get(k));
  const period = sp.get("month") ?? (sp.get("from") || sp.get("to") ? "custom" : "");
  const sel = "input py-2 pr-8 text-sm sm:w-auto";

  return (
    <div className={`card mb-5 p-3 transition ${pending ? "opacity-70" : ""}`}>
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        {show.has("q") && (
          <form className="relative md:w-64" onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() || null }); }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="input py-2 pl-9" placeholder="Search purchases" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
          </form>
        )}
        <button type="button" className="btn-secondary btn-sm md:hidden" onClick={() => setOpen(!open)} aria-expanded={open}>
          <SlidersHorizontal className="h-4 w-4" /> Filters {active.length ? `(${active.length})` : ""}
        </button>
        <div className={`${open ? "flex" : "hidden"} flex-col gap-2 md:flex md:flex-row md:flex-wrap md:items-center`}>
          {show.has("month") && (
            <select className={sel} aria-label="Period" value={period} onChange={(e) => e.target.value === "custom" ? set({ month: null, from: options.months.at(-1)?.value ? `${options.months.at(-1)!.value}-01` : null }) : set({ month: e.target.value || null, from: null, to: null })}>
              <option value="">All time</option>
              {options.months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              <option value="custom">Custom dates…</option>
            </select>
          )}
          {show.has("month") && period === "custom" && (
            <span className="flex items-center gap-1">
              <input type="date" className="input py-2" aria-label="From" value={sp.get("from") ?? ""} onChange={(e) => set({ from: e.target.value || null, month: null })} />
              <span className="text-slate-400">–</span>
              <input type="date" className="input py-2" aria-label="To" value={sp.get("to") ?? ""} onChange={(e) => set({ to: e.target.value || null, month: null })} />
            </span>
          )}
          {show.has("account") && (
            <select className={sel} aria-label="Account" value={sp.get("account") ?? ""} onChange={(e) => set({ account: e.target.value || null })}>
              <option value="">All accounts</option>
              {options.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          )}
          {show.has("institution") && options.institutions.length > 1 && (
            <select className={sel} aria-label="Bank" value={sp.get("institution") ?? ""} onChange={(e) => set({ institution: e.target.value || null })}>
              <option value="">All banks</option>
              {options.institutions.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          )}
          {show.has("merchant") && options.merchants && (
            <select className={sel} aria-label="Supplier" value={sp.get("merchant") ?? ""} onChange={(e) => set({ merchant: e.target.value || null })}>
              <option value="">All suppliers</option>
              {options.merchants.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
          {show.has("category") && (
            <select className={sel} aria-label="Category" value={sp.get("category") ?? ""} onChange={(e) => set({ category: e.target.value || null })}>
              <option value="">All categories</option>
              {options.categories.map((c) => <option key={c.id} value={c.id}>{c.depth ? "   " : ""}{c.label}</option>)}
            </select>
          )}
          {show.has("kind") && (
            <select className={sel} aria-label="Type" value={sp.get("kind") ?? ""} onChange={(e) => set({ kind: e.target.value || null })}>
              {(options.accountant ? KIND_OPTIONS_ACCT : KIND_OPTIONS_SIMPLE).map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          )}
          {show.has("ownership") && (
            <select className={sel} aria-label="Business or personal" value={sp.get("ownership") ?? ""} onChange={(e) => set({ ownership: e.target.value || null })}>
              <option value="">Business and personal</option>
              <option value="BUSINESS">Business only</option>
              <option value="PERSONAL">Personal only</option>
            </select>
          )}
          {show.has("currency") && options.currencies.length > 1 && (
            <select className={sel} aria-label="Currency" value={sp.get("currency") ?? ""} onChange={(e) => set({ currency: e.target.value || null })}>
              <option value="">All currencies</option>
              {options.currencies.map((c) => <option key={c} value={c}>{c} accounts</option>)}
            </select>
          )}
        </div>
        {active.length > 0 && (
          <button type="button" className="btn-ghost btn-sm md:ml-auto" onClick={() => { setQ(""); start(() => router.push(path)); }}>
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
