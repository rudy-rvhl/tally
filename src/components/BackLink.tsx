"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/** Goes back to the exact previous view (with its filters) when there is one. */
export function BackLink({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <Link href={fallback} onClick={(e) => { if (typeof window !== "undefined" && window.history.length > 1) { e.preventDefault(); router.back(); } }}
      className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900">
      <ArrowLeft className="h-4 w-4" /> {label}
    </Link>
  );
}
