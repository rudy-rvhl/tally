import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Logo } from "@/components/Logo";
import { SideNav, BottomNav } from "@/components/Nav";
import { HeaderAsk } from "@/components/HeaderAsk";
import { Upload } from "lucide-react";
import { ModeSwitch, SignOut } from "@/components/HeaderActions";
import { ScopeSwitch } from "@/components/ScopeSwitch";
import { resolveScope, scopeValue } from "@/lib/scope";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [reviewCount, scope] = await Promise.all([prisma.reviewItem.count({ where: { userId: user.id, status: "OPEN" } }), resolveScope(user.id)]);
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
          <HeaderAsk />
          {scope.multi && <ScopeSwitch companies={scope.companies} value={scopeValue(scope.scope)} />}
          <ModeSwitch accountant={accountant} />
          <Link href="/import" className="btn-primary px-3 lg:hidden" aria-label="Import a statement"><Upload className="h-4 w-4" /></Link>
          <SignOut />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">{children}</main>
      <BottomNav reviewCount={reviewCount} />
    </div>
  );
}
