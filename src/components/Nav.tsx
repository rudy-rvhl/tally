"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LayoutDashboard, ShoppingBag, Landmark, CheckCircle2, BarChart3, Upload, Calculator, Settings, FileText, Home, LineChart, CalendarCheck, FileCheck2 } from "lucide-react";

export const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard, desc: "Your finances at a glance" },
  { href: "/spending", label: "Spending", icon: ShoppingBag, desc: "By supplier, category, account or month" },
  { href: "/accounts", label: "Accounts", icon: Landmark, desc: "Bank accounts and cards" },
  { href: "/review", label: "Review", icon: CheckCircle2, desc: "Transactions to review" },
  { href: "/reports", label: "Reports", icon: BarChart3, desc: "Monthly summaries and trends" },
];

/** The pages under Reports, shown under it in the side menu and as tabs at the top of each. */
export const REPORT_PAGES = [
  { href: "/reports", label: "Monthly report", icon: FileText },
  { href: "/reports/rent-roll", label: "Rent roll", icon: Home },
  { href: "/reports/analysis", label: "Data analysis", icon: LineChart },
  { href: "/reports/payees", label: "Payee tracker", icon: CalendarCheck },
  { href: "/reports/suppliers", label: "Suppliers", icon: FileCheck2 },
];
const reportActive = (path: string, href: string) => (href === "/reports" ? path === "/reports" : path === href || path.startsWith(href + "/"));

const active = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

export function SideNav({ reviewCount, accountant }: { reviewCount: number; accountant: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
      <Link href="/import" className="btn-primary mb-4 w-full"><Upload className="h-4 w-4" /> Import a statement</Link>
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} aria-current={active(path, href) ? "page" : undefined}
          className={clsx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition", active(path, href) ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
          <Icon className="h-[18px] w-[18px]" />
          <span className="flex-1">{label}</span>
          {href === "/review" && reviewCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{reviewCount}</span>}
        </Link>
      ))}
      <div className="ml-5 flex flex-col gap-0.5 border-l border-slate-200 pl-3" aria-label="Reports">
        {REPORT_PAGES.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={reportActive(path, href) ? "page" : undefined}
            className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition", reportActive(path, href) ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900")}>
            <Icon className="h-4 w-4" /> {label}
          </Link>
        ))}
      </div>
      <div className="mt-auto space-y-1 border-t border-slate-100 pt-4">
        <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Advanced</p>
        {accountant && (
          <Link href="/accountant" className={clsx("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium", active(path, "/accountant") ? "bg-violet-50 text-violet-700" : "text-slate-600 hover:bg-slate-100")}>
            <Calculator className="h-[18px] w-[18px]" /> Accountant View
          </Link>
        )}
        <Link href="/settings" className={clsx("flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium", active(path, "/settings") ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-100")}>
          <Settings className="h-[18px] w-[18px]" /> Settings
        </Link>
      </div>
    </nav>
  );
}

export function BottomNav({ reviewCount }: { reviewCount: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} aria-current={active(path, href) ? "page" : undefined}
          className={clsx("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active(path, href) ? "text-brand-700" : "text-slate-500")}>
          <Icon className="h-5 w-5" />
          {label}
          {href === "/review" && reviewCount > 0 && <span className="absolute right-[22%] top-1 h-2 w-2 rounded-full bg-amber-500" />}
        </Link>
      ))}
    </nav>
  );
}

/** Tabs at the top of the report pages. */
export function ReportsTabs() {
  const path = usePathname();
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 print:hidden" role="tablist" aria-label="Reports">
      {REPORT_PAGES.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} role="tab" aria-selected={reportActive(path, href)}
          className={clsx("inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold", reportActive(path, href) ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}>
          <Icon className="h-4 w-4" /> {label}
        </Link>
      ))}
    </div>
  );
}
