"use client";
/**
 * Interactive charts. Every bar/slice/point is clickable and opens the transactions
 * behind it. Colours are consistent across the app: spending = blue, money in = green.
 */
import { useRouter } from "next/navigation";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ComposedChart,
} from "recharts";
import { formatMoney } from "@/lib/engine/money";

export const PALETTE = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#dc2626", "#4f46e5", "#94a3b8"];
const SPEND = "#2563eb", INCOME = "#059669";

const money = (v: number, c = "CAD") => formatMoney(v, c, { compact: Math.abs(v) >= 1000000 });
const axisMoney = (v: number) => formatMoney(v, "CAD", { compact: true });

function TooltipBox({ active, payload, label, currency = "CAD", footer }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; currency?: string; footer?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label && <div className="mb-1 font-semibold text-slate-800">{label}</div>}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-600"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="num font-semibold text-slate-900">{p.value === null || p.value === undefined ? "—" : money(p.value, currency)}</span>
        </div>
      ))}
      <div className="mt-1 text-[11px] text-slate-400">{footer ?? "Click to see transactions"}</div>
    </div>
  );
}

export interface TrendPoint { label: string; spending: number; income?: number; average?: number | null; href: string; incomplete?: boolean }

export function TrendChart({ data, showIncome = true, height = 260 }: { data: TrendPoint[]; showIncome?: boolean; height?: number }) {
  const router = useRouter();
  const go = (s: unknown) => { const st = s as { activePayload?: { payload: TrendPoint }[] } | null; const p = st?.activePayload?.[0]?.payload; if (p) router.push(p.href); };
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} onClick={go} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} className="cursor-pointer">
          <defs>
            <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={SPEND} stopOpacity={0.25} /><stop offset="100%" stopColor={SPEND} stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={axisMoney} tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} width={64} />
          <Tooltip content={<TooltipBox />} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="spending" name="Money spent" stroke={SPEND} strokeWidth={2.5} fill="url(#spendFill)" dot={{ r: 3 }} activeDot={{ r: 5 }} />
          {showIncome && <Line type="monotone" dataKey="income" name="Money received" stroke={INCOME} strokeWidth={2} dot={{ r: 2.5 }} />}
          {data.some((d) => d.average) && <Line type="monotone" dataKey="average" name="3-month average spent" stroke="#94a3b8" strokeDasharray="5 4" dot={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface Slice { label: string; value: number; href: string }

export function DonutChart({ data, currency = "CAD", height = 240 }: { data: Slice[]; currency?: string; height?: number }) {
  const router = useRouter();
  const total = data.reduce((s, d) => s + d.value, 0);
  const top = data.slice(0, 8);
  const rest = data.slice(8).reduce((s, d) => s + d.value, 0);
  const shown = rest > 0 ? [...top, { label: "Everything else", value: rest, href: top[0]?.href.split("?")[0] ?? "/transactions" }] : top;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div style={{ height }} className="relative">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="95%" paddingAngle={1.5} stroke="none" onClick={(d) => router.push((d as unknown as Slice).href)} className="cursor-pointer">
              {shown.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip content={<TooltipBox currency={currency} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><div className="text-xs text-slate-500">Total spent</div><div className="num text-lg font-bold">{money(total, currency)}</div></div>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {shown.map((d, i) => (
          <li key={d.label}>
            <button onClick={() => router.push(d.href)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-slate-50">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="flex-1 truncate text-slate-700">{d.label}</span>
              <span className="num text-slate-500">{total ? Math.round((d.value / total) * 100) : 0}%</span>
              <span className="num w-24 text-right font-medium">{money(d.value, currency)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stacked bars: spending per month split by account (or any series). */
/** hrefTemplate contains the literal tokens MONTH and SERIES, replaced with the row's month and the series key. */
export function StackedBars({ data, series, hrefTemplate, height = 260 }: { data: Record<string, number | string>[]; series: { key: string; label: string }[]; hrefTemplate: string; height?: number }) {
  const router = useRouter();
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={axisMoney} tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} width={64} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: "#f1f5f9" }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={PALETTE[i % PALETTE.length]} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
              className="cursor-pointer" onClick={(d) => router.push(hrefTemplate.replace("MONTH", String((d as unknown as { payload: Record<string, string> }).payload.month)).replace("SERIES", s.key))} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function IncomeVsSpending({ data, height = 260 }: { data: TrendPoint[]; height?: number }) {
  const router = useRouter();
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={axisMoney} tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} width={64} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: "#f1f5f9" }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="income" name="Money received" fill={INCOME} radius={[4, 4, 0, 0]} className="cursor-pointer" onClick={(d) => router.push((d as unknown as { payload: TrendPoint }).payload.href.replace("kind=spending", "kind=income"))} />
          <Bar dataKey="spending" name="Money spent" fill={SPEND} radius={[4, 4, 0, 0]} className="cursor-pointer" onClick={(d) => router.push((d as unknown as { payload: TrendPoint }).payload.href)} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MultiLine({ data, series, height = 260 }: { data: Record<string, number | string | null>[]; series: { key: string; label: string; href?: string }[]; height?: number }) {
  const router = useRouter();
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(s) => { const st = s as { activePayload?: { payload: { href?: string } }[] } | null; const h = st?.activePayload?.[0]?.payload?.href; if (h) router.push(h); }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={axisMoney} tick={{ fontSize: 12, fill: "#64748b" }} tickLine={false} axisLine={false} width={64} />
          <Tooltip content={<TooltipBox />} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Sparkline({ values, height = 36 }: { values: number[]; height?: number }) {
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }} className="w-24">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <Area type="monotone" dataKey="v" stroke={SPEND} fill={SPEND} fillOpacity={0.12} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
