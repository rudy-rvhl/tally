import Link from "next/link";
import clsx from "clsx";
import { CalendarCheck, Search } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { loadPayee, payeeOptions, payeesByType, type Direction, type PayeeOverview } from "@/lib/services/payees";
import { payeeFrequencyAction } from "@/app/actions";
import { formatDate, monthLabel } from "@/lib/engine/dates";
import { formatMoney } from "@/lib/engine/money";
import { txnLink } from "@/lib/filters";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ReportsTabs } from "@/components/Nav";
import { FREQUENCIES, FREQUENCY_LABEL, isFrequency, type PayeeFrequency, type PayeeMonthStatus, type PayeeSummary } from "@/lib/engine/payees";

export const metadata = { title: "Payee tracker" };

const STATUS: Record<PayeeMonthStatus, { label: string; box: string }> = {
  PAID: { label: "Paid", box: "border-emerald-200 bg-emerald-50" },
  LOW: { label: "Less than usual", box: "border-amber-200 bg-amber-50" },
  HIGH: { label: "More than usual", box: "border-sky-200 bg-sky-50" },
  MISSING: { label: "Not paid", box: "border-red-300 bg-red-50" },
  NO_STATEMENT: { label: "No statement imported", box: "border-dashed border-slate-300 bg-white" },
  NOT_STARTED: { label: "Before the first payment", box: "border-slate-100 bg-slate-50 opacity-60" },
  NOT_DUE: { label: "Nothing due", box: "border-slate-200 bg-white" },
};

const TYPE_STYLE: Record<PayeeFrequency, string> = {
  MONTHLY: "bg-violet-100 text-violet-800", QUARTERLY: "bg-indigo-100 text-indigo-800", YEARLY: "bg-sky-100 text-sky-800",
  ONE_TIME: "bg-slate-100 text-slate-700", IRREGULAR: "bg-amber-100 text-amber-800",
};
const TYPE_HELP: Record<PayeeFrequency, string> = {
  MONTHLY: "Paid every month (contractors, utilities, loans). A month with no payment is flagged as missed.",
  QUARTERLY: "Paid about every 3 months. Flagged when a payment is more than a month late.",
  YEARLY: "Paid about once a year (insurance, taxes, licences). Not counted as missed in the months between; flagged only when a year (and a grace month) passes without a payment.",
  ONE_TIME: "Paid once. Never counted as missed.",
  IRREGULAR: "Paid now and then, with no fixed schedule (supplies, repairs). Never counted as missed. If one of these is really a bill, open it and choose how often it's paid.",
};

function TypeBadge({ f, saved }: { f: PayeeFrequency; saved?: boolean }) {
  return <span className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", TYPE_STYLE[f])} data-frequency={f}>{FREQUENCY_LABEL[f].name}{saved ? " ✓" : ""}</span>;
}

/** The sentence at the top: depends on whether it's a monthly bill, a yearly payment or a one-off. */
function Summary({ s, dir, c }: { s: PayeeSummary; dir: Direction; c: string }) {
  const verb = dir === "out" ? "Paid" : "Received", none = dir === "out" ? "paid" : "received";
  const missed = s.missing.length
    ? <span className="font-semibold text-red-700">{s.frequency === "MONTHLY" ? `Nothing ${none} in` : "Expected but not " + none + " in"} {s.missing.map((m) => monthLabel(m)).join(", ")}.</span>
    : FREQUENCY_LABEL[s.frequency].recurring ? <span className="font-semibold text-emerald-700">No {s.frequency === "MONTHLY" ? "month" : "payment"} missed.</span> : null;
  const next = s.nextDue ? <> Next one expected around <strong>{monthLabel(s.nextDue)}</strong>.</> : null;
  const total = <> Total {formatMoney(s.totalCents, c)}{s.lastPaid ? `, last on ${formatDate(s.lastPaid, "long")}` : ""}.</>;
  switch (s.frequency) {
    case "MONTHLY":
      return <>{verb} in <strong>{s.paidMonths} of {s.expectedMonths}</strong> month{s.expectedMonths === 1 ? "" : "s"}{s.usualCents ? <>, usually <strong>{formatMoney(s.usualCents, c)}</strong> a month</> : null}. {missed}{total}</>;
    case "QUARTERLY": case "YEARLY":
      return <>{verb} {FREQUENCY_LABEL[s.frequency].every}{s.usualCents ? <>, usually <strong>{formatMoney(s.usualCents, c)}</strong> each time</> : null} ({s.payments} payment{s.payments === 1 ? "" : "s"} on record). {missed}{next}{total}</>;
    case "ONE_TIME":
      return <>A <strong>one-time</strong> {dir === "out" ? "payment" : "deposit"}, not a recurring bill, so no month is counted as missed.{total}</>;
    default:
      return <>{verb} {s.payments} time{s.payments === 1 ? "" : "s"} with <strong>no fixed schedule</strong>, so no month is counted as missed. If it&apos;s really a bill, choose how often it&apos;s paid below.{total}</>;
  }
}

export default async function PayeesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const dir: Direction = sp.dir === "in" ? "in" : "out";
  const n = sp.n === "24" ? 24 : 12;
  const payee = sp.payee || undefined, q = sp.q?.trim() || undefined;
  const c = user.baseCurrency;
  const freq = isFrequency(sp.freq) ? sp.freq : null;
  const [options, overview, result] = await Promise.all([
    payeeOptions(user.id, dir), payeesByType(user, dir),
    payee || q ? loadPayee(user, { payee, q, dir, n, freq }) : Promise.resolve(null),
  ]);
  const s = result?.summary;
  const monthHref = (m: string) => txnLink({}, { month: m, ...(payee ? { merchant: payee } : { q }) });

  return (
    <>
      <ReportsTabs />
      <PageHeader title="Payee tracker" subtitle="Pick someone you pay (or who pays you) and see, month by month, whether a payment was made." />

      <Card className="mb-6">
        <form method="get" className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto_auto] md:items-end" data-testid="payee-form">
          <div><label className="label" htmlFor="payee">Payee</label>
            <select id="payee" name="payee" className="input" defaultValue={payee ?? ""}>
              <option value="">Choose…</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.count})</option>)}
            </select></div>
          <div><label className="label" htmlFor="q">…or words on the statement</label>
            <input id="q" name="q" className="input" defaultValue={q ?? ""} placeholder="e.g. PRONTO" /></div>
          <div><label className="label" htmlFor="dir">Looking for</label>
            <select id="dir" name="dir" className="input" defaultValue={dir}><option value="out">Payments I made</option><option value="in">Money I received</option></select></div>
          <div><label className="label" htmlFor="n">Over</label>
            <select id="n" name="n" className="input" defaultValue={String(n)}><option value="12">12 months</option><option value="24">24 months</option></select></div>
          <button className="btn-primary"><Search className="h-4 w-4" /> Show</button>
        </form>
        <p className="mt-2 text-xs text-slate-500">If a payee and words are both given, both must match. Words find e-transfers to people who aren&apos;t a recognised supplier (e.g. “Interac e-Transfer Out to PRONTO …”).</p>
      </Card>

      {result && s && (result.rows.length ? (
        <>
          <Card className="mb-6" title={<span className="inline-flex items-center gap-2"><CalendarCheck className="h-4 w-4" /> {result.label}</span>}
            subtitle={`${monthLabel(result.months[0], "short")} – ${monthLabel(result.months[result.months.length - 1], "short")}`}>
            <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="payee-type">
              <TypeBadge f={s.frequency} saved={!!result.saved} />
              <span className="text-xs text-slate-500">{result.saved || freq ? "as you chose" : "detected from the payments"}</span>
            </div>
            <p className="mb-4 text-base text-slate-800" data-testid="payee-summary"><Summary s={s} dir={dir} c={c} /></p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="payee-months">
              {s.months.map((m) => (
                <Link key={m.month} href={monthHref(m.month)} className={clsx("rounded-xl border p-3 transition hover:shadow-sm", STATUS[m.status].box)} data-status={m.status}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{monthLabel(m.month, "short")}</div>
                  <div className={clsx("num mt-1 text-lg font-bold", m.status === "MISSING" ? "text-red-700" : "text-slate-900")}>{m.totalCents ? formatMoney(m.totalCents, c) : "—"}</div>
                  <div className="text-xs text-slate-600">{STATUS[m.status].label}{m.count > 1 ? ` · ${m.count} payments` : ""}</div>
                  {m.dates.length > 0 && <div className="mt-0.5 text-[11px] text-slate-500">{m.dates.map((d) => formatDate(d)).join(", ")}</div>}
                </Link>
              ))}
            </div>
            <form action={payeeFrequencyAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4" data-testid="payee-frequency-form">
              {payee && <input type="hidden" name="payee" value={payee} />}
              {q && <input type="hidden" name="q" value={q} />}
              <input type="hidden" name="dir" value={dir} /><input type="hidden" name="n" value={String(n)} />
              <div><label className="label" htmlFor="freq">How often is this paid?</label>
                <select id="freq" name="freq" className="input" defaultValue={result.saved ?? freq ?? "AUTO"}>
                  <option value="AUTO">Work it out from the payments ({FREQUENCY_LABEL[s.detected].name.toLowerCase()})</option>
                  {FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABEL[f].name}</option>)}
                </select></div>
              <button className="btn-secondary">{payee ? "Save for this payee" : "Apply"}</button>
              <p className="w-full text-xs text-slate-500">{TYPE_HELP[s.frequency]}</p>
            </form>
          </Card>
          <Card padded={false} title={`${result.rows.length} ${dir === "out" ? "payment" : "deposit"}${result.rows.length === 1 ? "" : "s"}`}>
            <ul className="divide-y divide-slate-100 text-sm">
              {result.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                  <span className="w-28 text-slate-500">{formatDate(r.date)}</span>
                  <Link className="min-w-[12rem] flex-1 hover:text-brand-700" href={`/transactions/${r.id}`}>{r.description}</Link>
                  <span className="text-xs text-slate-500">{r.account.name}</span>
                  <span className="num w-28 text-right font-semibold">{formatMoney(Math.abs(r.amountCents), r.currency)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : <Card><EmptyState title={`Nothing found for “${result.label}”`} body={`No ${dir === "out" ? "payments" : "money received"} matched in the last ${n} months. Try other words from the statement, or the other direction.`} /></Card>)}

      <Card title={dir === "out" ? "Bills with a missed payment" : "Regular payers with a missed payment"} className={result ? "mt-6" : ""}
        subtitle="Monthly bills with a month not paid, and yearly or quarterly payments that are overdue, in the last 12 months.">
        {overview.missed.length ? (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="payee-gaps">
            {overview.missed.map((g) => (
              <li key={g.id}><Link href={`/reports/payees?payee=${g.id}&dir=${dir}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 hover:text-brand-700">
                <span className="flex items-center gap-2 font-medium">{g.name} <TypeBadge f={g.frequency} saved={g.saved} /></span>
                <span className="text-slate-600">{g.usualCents ? `usually ${formatMoney(g.usualCents, c)} · ` : ""}<span className="font-semibold text-red-700">missed {g.missing.map((m) => monthLabel(m, "short")).join(", ")}</span></span>
              </Link></li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No bill has a missed payment in the last 12 months.</p>}
      </Card>

      <Card className="mt-6" title={dir === "out" ? "Everyone you paid, by type" : "Everyone who paid you, by type"}
        subtitle="Recurring bills are checked for missed payments; one-time and occasional payments never are. Wrong type? Open the payee and choose how often it's paid.">
        <div className="grid gap-6 lg:grid-cols-2" data-testid="payee-types">
          {FREQUENCIES.map((f) => <TypeList key={f} f={f} list={overview.byType[f]} dir={dir} c={c} />)}
        </div>
      </Card>
    </>
  );
}

function TypeList({ f, list, dir, c }: { f: PayeeFrequency; list: PayeeOverview[]; dir: Direction; c: string }) {
  const shown = list.slice(0, 15);
  return (
    <section data-type={f}>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800"><TypeBadge f={f} /> <span className="text-slate-500">{list.length}</span></h3>
      <p className="mb-2 text-xs text-slate-500">{TYPE_HELP[f]}</p>
      {shown.length ? (
        <ul className="divide-y divide-slate-100 text-sm">
          {shown.map((p) => (
            <li key={p.id}><Link href={`/reports/payees?payee=${p.id}&dir=${dir}`} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 hover:text-brand-700">
              <span className="font-medium">{p.name}{p.saved ? <span className="ml-1 text-xs text-slate-400">(your choice)</span> : null}</span>
              <span className="text-xs text-slate-600">
                {FREQUENCY_LABEL[f].recurring
                  ? <>{p.usualCents ? `${formatMoney(p.usualCents, c)} ${f === "MONTHLY" ? "a month" : "each time"}` : ""}
                    {p.missing.length ? <span className="ml-1 font-semibold text-red-700">· missed {p.missing.map((m) => monthLabel(m, "short")).join(", ")}</span>
                      : f !== "MONTHLY" && p.nextDue ? <> · next ~{monthLabel(p.nextDue, "short")}</> : null}</>
                  : <>{formatMoney(p.totalCents, c)}{p.lastPaid ? ` · ${formatDate(p.lastPaid)}` : ""}</>}
              </span>
            </Link></li>
          ))}
        </ul>
      ) : <p className="text-xs text-slate-400">None.</p>}
      {list.length > shown.length && <p className="mt-1 text-xs text-slate-500">…and {list.length - shown.length} more (pick them in the list above).</p>}
    </section>
  );
}
