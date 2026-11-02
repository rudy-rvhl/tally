"use client";
import { usePathname } from "next/navigation";
import { AskBar } from "./AskBar";

/** The overview has its own large question bar, so the header one is hidden there. */
export function HeaderAsk() {
  const path = usePathname();
  if (path === "/" || path === "/ask") return <div className="flex-1" />;
  return <div className="min-w-0 flex-1"><AskBar /></div>;
}
