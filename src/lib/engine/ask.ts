/**
 * Natural-language question -> structured query.
 *
 * This module only INTERPRETS the question. It never produces a number.
 * Every amount shown in an answer is computed afterwards by a database query
 * (src/lib/services/ask.ts) from the structured spec, and the answer links to the
 * exact transactions it summed.
 */
import { z } from "zod";
import { addMonths, isoDate, monthKey, monthRange } from "./dates";

export const QuerySpecSchema = z.object({
  intent: z.enum(["total", "list", "top", "compare", "price_increases", "count", "by_supplier", "by_category"]),
  flow: z.enum(["spending", "income", "all"]),
  merchantIds: z.array(z.string()),
  categoryIds: z.array(z.string()),
  accountIds: z.array(z.string()),
  from: z.string().describe("YYYY-MM-DD inclusive"),
  to: z.string().describe("YYYY-MM-DD inclusive"),
  rangeLabel: z.string(),
  compareFrom: z.string().nullable(),
  compareTo: z.string().nullable(),
  compareLabel: z.string().nullable(),
  limit: z.number().int().nullable(),
});
export type QuerySpec = z.infer<typeof QuerySpecSchema>;

export interface AskEntities {
  merchants: { id: string; name: string }[];
  categories: { id: string; name: string; parent: string | null }[];
  accounts: { id: string; name: string; institution: string; type: string; mask: string | null }[];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}))?/gi;
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20 };

const INSTITUTION_ALIASES: Array<[RegExp, RegExp]> = [
  [/\bamex\b|american express/, /american express|amex/],
  [/\bscotia(bank)?\b/, /scotia/],
  [/\brbc\b|royal bank/, /rbc|royal/],
  [/\btd\b/, /\btd\b|toronto/],
  [/\bbmo\b/, /bmo|montreal/],
  [/\bcibc\b/, /cibc/],
  [/\bdesjardins\b/, /desjardins/],
  [/national bank|\bnbc\b/, /national/],
  [/\bvisa\b/, /visa/],
  [/\bmastercard\b|\bmc\b/, /mastercard|\bmc\b/],
];

function monthIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(w));
}

function resolveMonth(word: string, year: string | undefined, today: Date): string {
  const idx = monthIndex(word);
  if (year) return `${year}-${String(idx + 1).padStart(2, "0")}`;
  // Most recent occurrence that isn't in the future.
  let y = today.getUTCFullYear();
  if (idx > today.getUTCMonth()) y -= 1;
  return `${y}-${String(idx + 1).padStart(2, "0")}`;
}

function rangeOfMonth(key: string) {
  const r = monthRange(key);
  return { from: isoDate(r.start), to: isoDate(r.end) };
}

const label = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} ${y}`;
};

export function parseQuestion(question: string, entities: AskEntities, today: Date): QuerySpec {
  const q = question.toLowerCase().replace(/[’']/g, "'");
  const thisMonth = monthKey(today);
  const spec: QuerySpec = {
    intent: "total", flow: "spending", merchantIds: [], categoryIds: [], accountIds: [],
    from: `${today.getUTCFullYear()}-01-01`, to: isoDate(today), rangeLabel: "this year so far",
    compareFrom: null, compareTo: null, compareLabel: null, limit: null,
  };

  // ---- dates
  const months = [...q.matchAll(MONTH_RE)].filter((m) => !(m[1] === "may" && !/\bin may\b|\bmay \d{4}|may (with|vs|and)|(with|vs|and) may\b/.test(q)));
  if (/\blast year\b/.test(q)) {
    const y = today.getUTCFullYear() - 1;
    Object.assign(spec, { from: `${y}-01-01`, to: `${y}-12-31`, rangeLabel: `in ${y}` });
  } else if (/\bthis month\b/.test(q)) {
    Object.assign(spec, rangeOfMonth(thisMonth), { to: isoDate(today), rangeLabel: "this month" });
  } else if (/\blast month\b/.test(q)) {
    const k = addMonths(thisMonth, -1);
    Object.assign(spec, rangeOfMonth(k), { rangeLabel: `in ${label(k)}` });
  } else if (/\blast (\d+|three|six|twelve) months\b/.test(q)) {
    const n = Number(q.match(/\blast (\d+)/)?.[1]) || { three: 3, six: 6, twelve: 12 }[q.match(/\blast (three|six|twelve)/)![1] as "three"]!;
    const start = addMonths(thisMonth, -(n - 1));
    Object.assign(spec, { from: isoDate(monthRange(start).start), to: isoDate(today), rangeLabel: `in the last ${n} months` });
  } else if (/\b(all time|ever|lifetime|in total)\b/.test(q)) {
    Object.assign(spec, { from: "1900-01-01", to: isoDate(today), rangeLabel: "since your first imported statement" });
  } else if (months.length >= 1) {
    const k = resolveMonth(months[0][1], months[0][2], today);
    Object.assign(spec, rangeOfMonth(k), { rangeLabel: `in ${label(k)}` });
  } else if (/\b(20\d{2})\b/.test(q)) {
    const y = q.match(/\b(20\d{2})\b/)![1];
    Object.assign(spec, { from: `${y}-01-01`, to: `${y}-12-31`, rangeLabel: `in ${y}` });
  }

  // ---- intent
  const topN = q.match(/\b(?:top|largest|biggest)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\b/) ??
    q.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twenty)\s+(?:largest|biggest)\b/);
  if (/\bcompare\b|\bvs\.?\b|\bversus\b/.test(q)) {
    spec.intent = "compare";
    if (months.length >= 2) {
      const a = resolveMonth(months[0][1], months[0][2], today), b = resolveMonth(months[1][1], months[1][2], today);
      Object.assign(spec, rangeOfMonth(a), { rangeLabel: label(a) });
      const rb = rangeOfMonth(b);
      Object.assign(spec, { compareFrom: rb.from, compareTo: rb.to, compareLabel: label(b) });
    } else if (/this month/.test(q) || months.length === 1) {
      const a = months.length === 1 ? resolveMonth(months[0][1], months[0][2], today) : thisMonth;
      const b = addMonths(a, -1);
      Object.assign(spec, rangeOfMonth(a), { rangeLabel: label(a) });
      const rb = rangeOfMonth(b);
      Object.assign(spec, { compareFrom: rb.from, compareTo: rb.to, compareLabel: label(b) });
    } else {
      const a = addMonths(thisMonth, -1), b = addMonths(thisMonth, -2);
      Object.assign(spec, rangeOfMonth(a), { rangeLabel: label(a) });
      const rb = rangeOfMonth(b);
      Object.assign(spec, { compareFrom: rb.from, compareTo: rb.to, compareLabel: label(b) });
    }
  } else if (/(increase|raise|raised|went up|higher).*(price|cost|charge)|price.*(increase|went up|higher)|(suppliers|subscriptions).*(increase|went up)/.test(q)) {
    spec.intent = "price_increases";
    if (!months.length && !/last|this|20\d{2}/.test(q)) Object.assign(spec, { from: "1900-01-01", rangeLabel: "across all your imported statements" });
  } else if (topN || /\b(largest|biggest) (expenses|purchases|transactions)\b/.test(q)) {
    spec.intent = "top";
    const raw = topN?.[1];
    spec.limit = raw ? (NUM_WORDS[raw] ?? Number(raw)) : 5;
  } else if (/\bhow many\b/.test(q)) {
    spec.intent = "count";
  } else if (/\b(which|top) (suppliers|merchants|vendors|stores)\b|\bby (supplier|merchant)\b|\bwho did (i|we) (spend|pay)/.test(q)) {
    spec.intent = "by_supplier";
  } else if (/\bby category\b|\bwhich categor/.test(q)) {
    spec.intent = "by_category";
  } else if (/\b(show|list|see|find|display)\b|\ball (purchases|transactions|charges)\b/.test(q)) {
    spec.intent = "list";
  }

  if (/\b(receive|received|earn|earned|income|revenue|deposits?|got paid|sales)\b/.test(q) && !/\bspen[dt]\b/.test(q)) spec.flow = "income";

  // ---- entities (longest names first so "Amazon Web Services" beats "Amazon")
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9&. -]/g, " ").trim();
  const contains = (hay: string, needle: string) => needle.length >= 2 && new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}('?s)?([^a-z0-9]|$)`).test(hay);
  const merchants = [...entities.merchants].sort((a, b) => b.name.length - a.name.length);
  let rest = q;
  for (const m of merchants) {
    const n = words(m.name);
    if (n.length >= 3 && contains(rest, n)) { spec.merchantIds.push(m.id); rest = rest.replace(n, " "); }
  }
  for (const c of entities.categories) {
    const n = words(c.name);
    if (n.length < 4 || ["other", "uncategorized", "income", "money movement"].includes(n)) continue;
    const singular = n.replace(/s$/, "");
    if (contains(rest, n) || contains(rest, singular)) spec.categoryIds.push(c.id);
  }
  // A parent and its child both matched (e.g. "Insurance" twice) -> keep both; the executor includes descendants.
  for (const [say, match] of INSTITUTION_ALIASES) {
    if (!say.test(rest)) continue;
    for (const a of entities.accounts) if (match.test(`${a.institution} ${a.name}`.toLowerCase())) spec.accountIds.push(a.id);
  }
  for (const a of entities.accounts) {
    const n = words(a.name);
    if (n.length >= 4 && contains(rest, n) && !spec.accountIds.includes(a.id)) spec.accountIds.push(a.id);
  }
  spec.accountIds = [...new Set(spec.accountIds)];
  return spec;
}

export const EXAMPLE_QUESTIONS = [
  "How much did we spend on Amazon this year?",
  "Show me all purchases on my Amex in September",
  "What were my five largest expenses last month?",
  "Compare October with September",
  "How much did I spend on software this year?",
  "Which suppliers increased their prices?",
];
