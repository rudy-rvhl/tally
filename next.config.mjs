/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["exceljs", "bcryptjs", "pdfjs-dist", "tesseract.js", "@napi-rs/canvas", "@tesseract.js-data/eng", "@tesseract.js-data/fra"],
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
      ],
    }];
  },
};
export default nextConfig;
