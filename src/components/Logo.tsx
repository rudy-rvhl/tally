export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M5 19V9M12 19V5M19 19v-7" /></svg>
      </span>
      {!compact && <span className="text-lg font-bold tracking-tight text-slate-900">Ledger<span className="text-brand-600">IQ</span></span>}
    </span>
  );
}
