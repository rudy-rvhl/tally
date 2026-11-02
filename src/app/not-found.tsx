import Link from "next/link";
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4 text-center">
      <div><h1 className="text-2xl font-bold">We couldn&apos;t find that page</h1><p className="mt-2 text-slate-500">It may have been moved, or the link is incomplete.</p><Link href="/" className="btn-primary mt-6">Back to overview</Link></div>
    </main>
  );
}
