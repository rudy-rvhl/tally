/**
 * Runs once when the server starts. Next.js also compiles this file for the edge runtime, so
 * server-only code (PDF reading, database) lives in instrumentation-node.ts and is imported only
 * inside this exact check, which the compiler removes from the edge build.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
