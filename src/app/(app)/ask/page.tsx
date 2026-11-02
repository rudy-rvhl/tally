import Link from "next/link";
import { ShieldCheck, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { answerQuestion } from "@/lib/services/ask";
import { EXAMPLE_QUESTIONS } from "@/lib/engine/ask";
import { txnLink } from "@/lib/filters";
import { formatMoney, formatPct } from "@/lib/engine/money";
import { Card, Notice, PageHeader } from "@/components/ui";
import { AskBar } from "@/components/AskBar";

export const metadata = { title: "Ask" };

export default async function AskPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const q = ((await searchParams).q ?? "").slice(0, 300);
  const a = q ? await answerQuestion(user, q) : null;
  const c = user.baseCurrency;
  return (
    <>
      <PageHeader title="Ask about your spending" subtitle="Answers are calculated from your imported transactions, and you can always see the transactions behind them." />
      <div className="mb-6"><AskBar size="lg" initial={q} suggestions={a ? [] : EXAMPLE_QUESTIONS} /></div>
      {a && (
        <div className="space-y-6">
          <Card>
            <p className="text-sm text-slate-500">We understood: <span className="font-medium text-slate-700">{a.understood}</span></p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{a.headline}</h2>
            {a.explanation.map((e) => <p key={e} className="mt-1 text-slate-600">{e}</p>)}
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={txnLink({}, a.sourceFilters)} className="btn-primary">See the transactions <ChevronRight className="h-4 w-4" /></Link>
              {a.compareFilters && <Link href={txnLink({}, a.compareFilters)} className="btn-secondary">See the comparison period</Link>}
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400"><ShieldCheck className="h-3.5 w-3.5" />
              Totals come straight from your transactions{a.interpretedBy === "ai" ? ". AI only helped understand the question" : ""}. Card payments and transfers between your accounts are never counted as spending.
            </p>
          </Card>
          {a.warnings.map((w) => <Notice key={w} tone="amber">{w}</Notice>)}
          {a.rows.length > 0 && (
            <Card title={a.rowsTitle} padded={false}>
              <ul className="divide-y divide-slate-100">
                {a.rows.map((r, i) => (
                  <li key={i}>
                    <Link href={r.href ?? txnLink({}, r.link)} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0 flex-1"><div className="truncate font-medium">{r.label}</div>{r.sub && <div className="text-xs text-slate-500">{r.sub}</div>}</div>
                      {r.secondaryCents !== undefined && <span className="num hidden text-sm text-slate-500 sm:block">{formatMoney(r.secondaryCents, c)}</span>}
                      {r.changePct !== undefined && <span className={`num text-sm ${(r.changePct ?? 0) > 0 ? "text-red-700" : "text-emerald-700"}`}>{formatPct(r.changePct ?? null)}</span>}
                      <span className="num w-28 text-right font-semibold">{formatMoney(r.amountCents, c)}</span>
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div><p className="mb-2 text-sm text-slate-500">Try another question:</p><AskBar suggestions={EXAMPLE_QUESTIONS.filter((e) => e !== q)} /></div>
        </div>
      )}
    </>
  );
}
