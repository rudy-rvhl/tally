import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";

/** Download form for the Excel bank book (plain GET form: works without JavaScript). */
export function BankBookExport({ years, defaultStart, needsSetup }: { years: { start: string; label: string }[]; defaultStart: string; needsSetup: string[] }) {
  return (
    <div className="card p-5">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><FileSpreadsheet className="h-5 w-5" /></span>
        <div className="flex-1">
          <h2 className="text-base font-semibold">Bank book for your accountant (Excel)</h2>
          <p className="mt-0.5 text-sm text-slate-500">One sheet per account, one block per month: Date, #, Name, Description, inv. #, Debit (money in), Credit (money out), Balance, with yearly totals and a SUMMARY sheet.</p>
          <form action="/api/export/bankbook" method="get" className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="label text-xs" htmlFor="bb-start">Fiscal year</label>
              <select id="bb-start" name="start" defaultValue={defaultStart} className="input py-2">
                {years.map((y) => <option key={y.start} value={y.start}>{y.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs" htmlFor="bb-detail">Lines</label>
              <select id="bb-detail" name="detail" defaultValue="grouped" className="input py-2">
                <option value="grouped">One line per supplier per month</option>
                <option value="full">Every transaction, with its date</option>
              </select>
            </div>
            <button className="btn-primary">Download Excel</button>
          </form>
          {needsSetup.length > 0 && (
            <p className="mt-3 text-xs text-amber-800">
              To match your accountant&apos;s workbook: {needsSetup.join("; ")}. <Link href="/settings#company" className="underline">Settings</Link> · <Link href="/accounts" className="underline">Accounts</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
