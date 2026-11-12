import { readFileSync } from "node:fs";

// Local-only mode (default) and bank connections decide what the browser may talk to.
const fileEnv = (() => { try { return Object.fromEntries(readFileSync(".env", "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]])); } catch { return {}; } })();
const env = (k) => process.env[k] ?? fileEnv[k];
const localOnly = (env("LEDGERIQ_LOCAL_ONLY") ?? "true").toLowerCase() !== "false";
const plaid = !localOnly && !!env("PLAID_CLIENT_ID");
const dev = process.env.NODE_ENV !== "production";

// Content Security Policy: pages may only load from and send to this app. Nothing else, unless
// bank connections are deliberately enabled (then Plaid's sign-in window only).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${plaid ? " https://cdn.plaid.com" : ""}`,
  `connect-src 'self'${dev ? " ws: wss:" : ""}${plaid ? " https://*.plaid.com" : ""}`,
  `frame-src ${plaid ? "https://cdn.plaid.com https://*.plaid.com" : "'none'"}`,
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["exceljs", "bcryptjs", "pdfjs-dist", "tesseract.js", "@napi-rs/canvas", "@tesseract.js-data/eng", "@tesseract.js-data/fra"],
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};
export default nextConfig;
