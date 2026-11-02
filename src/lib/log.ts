/** Structured JSON logging. Never log descriptions, amounts or account numbers. */
type Level = "info" | "warn" | "error";
export function log(level: Level, event: string, fields: Record<string, string | number | boolean | null | undefined> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
