"use client";
/** Navigate after a successful form action. */
export function goTo(router: { push: (href: string) => void }, href: string) {
  router.push(href);
}
