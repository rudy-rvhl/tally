/**
 * "Organize": put every account and transaction in the right company and building from a short
 * plan written in plain words, one company per line:
 *
 *   1001-2002 Québec Inc: 1001 | Maple, 12 Oak, 14 Oak, 16 Oak, St-Laurent
 *   20304050 Canada Inc: 20304050 Desjardins, Amex, Pine | 18 Oak, Pine
 *
 * Before "|": words that identify the company's accounts (in the account's name, bank, number, or the
 * company name printed on its statements). After "|": the company's buildings.
 */

export interface PlanCompany { name: string; accountWords: string[]; buildings: string[] }

export function parsePlan(text: string): { companies: PlanCompany[]; errors: string[] } {
  const companies: PlanCompany[] = [];
  const errors: string[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 1) { errors.push(`Line ${i + 1}: write the company name, then ":" (e.g. "1001-2002 Québec Inc: 1001 | 12 Oak").`); continue; }
    const name = line.slice(0, colon).trim();
    const [acc, bld = ""] = line.slice(colon + 1).split("|");
    const list = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    companies.push({ name, accountWords: list(acc), buildings: list(bld) });
  }
  return { companies, errors };
}

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\bamerican express\b/g, "amex american express").replace(/\bsaint\b|\bste?\b(?=[\s-])/g, "st").replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter(Boolean);

/** A company's identifying number ("1001" for "1001-2002 Québec Inc", "20304050" for "20304050 Canada Inc"), else its name. */
export const companyKey = (name: string) => name.match(/\d{4,}/)?.[0] ?? norm(name).replace(/\b(inc|ltee|ltd|corp|quebec|canada)\b/g, "").trim();

/** Every word of the phrase appears in the text ("20304050 Desjardins" needs both). Numbers match as prefixes of longer numbers too. */
export function phraseIn(phrase: string, text: string): boolean {
  const t = ` ${norm(text)} `;
  const words = tokens(phrase);
  return words.length > 0 && words.every((w) => (/^\d+$/.test(w) ? t.includes(` ${w}`) : t.includes(` ${w} `)));
}

const STREET = new Set(["av", "ave", "avenue", "rue", "street", "st", "boul", "blvd", "boulevard", "chemin", "ch", "road", "rd", "des", "de", "du", "la", "le", "unit"]);
/** The parts of a building name that identify it: its street number and its distinctive words. */
export function buildingParts(name: string): { number: string | null; words: string[] } {
  const t = tokens(name);
  return { number: t.find((w) => /^\d+[a-z]?$/.test(w)) ?? null, words: t.filter((w) => !/^\d/.test(w) && w.length >= 3 && !STREET.has(w)) };
}

/** Same building? "12 Oak" ~ "12 Av. Oak"; "St-Laurent" ~ "5473 Rue Saint-Laurent"; "Maple" ~ "Maple". */
export function sameBuilding(a: string, b: string): boolean {
  const x = buildingParts(a), y = buildingParts(b);
  if (x.number && y.number) return x.number === y.number && (x.words.some((w) => y.words.includes(w)) || !x.words.length || !y.words.length);
  return x.words.some((w) => y.words.includes(w));
}

/** Does a transaction's description point to this building? Needs the street number and street name, or a distinctive name. */
export function mentionsBuilding(name: string, description: string): boolean {
  const { number, words } = buildingParts(name);
  const d = ` ${norm(description)} `;
  if (number) return d.includes(` ${number} `) && (words.length === 0 || words.some((w) => d.includes(` ${w} `)));
  return words.some((w) => w.length >= 5 && d.includes(` ${w} `));
}
