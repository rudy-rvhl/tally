import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Logo";
import { SideNav, BottomNav } from "@/components/Nav";
import { AskBar } from "@/components/AskBar";
import { logoutAction, setModeAction } from "@/app/actions";
import { LogOut, Upload } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const reviewCount = await prisma.reviewItem.count({ where: { userId: user.id, status: "OPEN" } });
  const accountant = user.mode === "ACCOUNTANT";
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <Link href="/" className="mb-6 px-2"><Logo /></Link>
        <SideNav reviewCount={reviewCount} accountant={accountant} />
      </aside>
      <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-[#f6f7fb]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="lg:hidden"><Logo compact /></Link>
          <div className="min-w-0 flex-1"><AskBar /></div>
          <form action={setModeAction} className="hidden sm:block">
            <input type="hidden" name="mode" value={accountant ? "SIMPLE" : "ACCOUNTANT"} />
            <button className="rounded-full border border-slate-200 bg-white p-1 text-xs font-semibold" title="Switch between the simple view and the accountant view. Both use the same numbers.">
              <span className={`inline-block rounded-full px-3 py-1 ${!accountant ? "bg-brand-600 text-white" : "text-slate-500"}`}>Simple</span>
              <span className={`inline-block rounded-full px-3 py-1 ${accountant ? "bg-violet-600 text-white" : "text-slate-500"}`}>Accountant</span>
            </button>
          </form>
          <Link href="/import" className="btn-primary px-3 lg:hidden" aria-label="Import a statement"><Upload className="h-4 w-4" /></Link>
          <form action={logoutAction}><button className="btn-ghost px-2.5" aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button></form>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">{children}</main>
      <BottomNav reviewCount={reviewCount} />
    </div>
  );
}
