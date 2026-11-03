/**
 * Merchant consolidation ("Combine supplier names").
 *
 * Bank descriptors for the same business vary wildly (AMZN MKTP CA*2K3, AMAZON.CA, ...).
 * We (1) clean the descriptor into a stable key, (2) check user-defined aliases,
 * (3) check a curated list of known merchant families, (4) fall back to a derived
 * name from the cleaned key. Every result carries a confidence so the review queue
 * can ask the user about uncertain merges instead of silently combining businesses.
 */

export interface KnownMerchant {
  name: string;
  patterns: RegExp[];
  /** Category path "Parent > Child" suggested when nothing better is known. */
  category?: string;
  /** Confidence of the family match. Lower for sub-services that may deserve separate tracking. */
  confidence?: number;
}

// Order matters: more specific families first (AWS before Amazon).
export const KNOWN_MERCHANTS: KnownMerchant[] = [
  { name: "Amazon Web Services", patterns: [/\bAWS\b/, /AMAZON WEB SERVICES/], category: "Business > Software", confidence: 0.97 },
  { name: "Amazon", patterns: [/\bAMAZON PRIME\b/, /\bPRIME VIDEO\b/], category: "Entertainment > Subscriptions", confidence: 0.8 },
  { name: "Amazon", patterns: [/\bAMZN\b/, /\bAMAZON\b/, /AMAZON\.(CA|COM)/, /AMZ\s?MKTP/], category: "Shopping > General merchandise", confidence: 0.95 },
  { name: "American Express", patterns: [/\bAMERICAN EXP/, /\bAMEX\b/], category: "Other > Uncategorized", confidence: 0.9 },
  { name: "Costco", patterns: [/\bCOSTCO\b/], category: "Food > Groceries", confidence: 0.95 },
  { name: "Walmart", patterns: [/\bWAL-?MART\b/, /\bWM SUPERCENTER\b/], category: "Shopping > General merchandise", confidence: 0.95 },
  { name: "Loblaws", patterns: [/\bLOBLAWS?\b/], category: "Food > Groceries", confidence: 0.95 },
  { name: "Metro", patterns: [/^METRO\b/, /\bMETRO PLUS\b/], category: "Food > Groceries", confidence: 0.85 },
  { name: "IGA", patterns: [/\bIGA\b/], category: "Food > Groceries", confidence: 0.9 },
  { name: "Provigo", patterns: [/\bPROVIGO\b/], category: "Food > Groceries", confidence: 0.95 },
  { name: "Sobeys", patterns: [/\bSOBEYS\b/], category: "Food > Groceries", confidence: 0.95 },
  { name: "Tim Hortons", patterns: [/\bTIM HORTON/, /\bTIMHORTON/], category: "Food > Coffee shops", confidence: 0.95 },
  { name: "Starbucks", patterns: [/\bSTARBUCKS\b/], category: "Food > Coffee shops", confidence: 0.95 },
  { name: "Uber Eats", patterns: [/\bUBER\s?\*?\s?EATS\b/, /UBEREATS/], category: "Food > Food delivery", confidence: 0.95 },
  { name: "Uber", patterns: [/\bUBER\b/], category: "Transportation > Public transit", confidence: 0.85 },
  { name: "DoorDash", patterns: [/\bDOORDASH\b/, /\bDD \*DOORDASH/], category: "Food > Food delivery", confidence: 0.95 },
  { name: "SkipTheDishes", patterns: [/SKIP ?THE ?DISHES/], category: "Food > Food delivery", confidence: 0.95 },
  { name: "Netflix", patterns: [/\bNETFLIX\b/], category: "Entertainment > Streaming", confidence: 0.97 },
  { name: "Spotify", patterns: [/\bSPOTIFY\b/], category: "Entertainment > Streaming", confidence: 0.97 },
  { name: "Apple", patterns: [/\bAPPLE\.COM\b/, /\bAPPLE STORE\b/, /\bITUNES\b/], category: "Shopping > Electronics", confidence: 0.85 },
  { name: "Google", patterns: [/\bGOOGLE\b/, /\bGSUITE\b/], category: "Business > Software", confidence: 0.85 },
  { name: "Microsoft", patterns: [/\bMICROSOFT\b/, /\bMSFT\b/], category: "Business > Software", confidence: 0.9 },
  { name: "Adobe", patterns: [/\bADOBE\b/], category: "Business > Software", confidence: 0.95 },
  { name: "Shopify", patterns: [/\bSHOPIFY\b/], category: "Business > Software", confidence: 0.95 },
  { name: "Slack", patterns: [/\bSLACK\b/], category: "Business > Software", confidence: 0.95 },
  { name: "Zoom", patterns: [/\bZOOM\.US\b/, /\bZOOM VIDEO\b/], category: "Business > Software", confidence: 0.95 },
  { name: "Intuit", patterns: [/\bINTUIT\b/, /\bQUICKBOOKS\b/], category: "Business > Software", confidence: 0.95 },
  { name: "Canva", patterns: [/\bCANVA\b/], category: "Business > Software", confidence: 0.95 },
  { name: "Anthropic", patterns: [/\bANTHROPIC\b/, /\bCLAUDE\.AI\b/], category: "Business > Software", confidence: 0.95 },
  { name: "OpenAI", patterns: [/\bOPENAI\b/, /\bCHATGPT\b/], category: "Business > Software", confidence: 0.95 },
  { name: "Meta Ads", patterns: [/\bFACEBK\b/, /\bFACEBOOK\b/, /\bMETA PLATFORMS\b/], category: "Business > Marketing", confidence: 0.9 },
  { name: "LinkedIn", patterns: [/\bLINKEDIN\b/], category: "Business > Marketing", confidence: 0.9 },
  { name: "Staples", patterns: [/\bSTAPLES\b/, /\bBUREAU EN GROS\b/], category: "Business > Office expenses", confidence: 0.95 },
  { name: "Home Depot", patterns: [/\bHOME DEPOT\b/], category: "Housing > Maintenance", confidence: 0.95 },
  { name: "Canadian Tire", patterns: [/\bCANADIAN TIRE\b/, /\bCDN TIRE\b/], category: "Shopping > Household products", confidence: 0.95 },
  { name: "Best Buy", patterns: [/\bBEST ?BUY\b/], category: "Shopping > Electronics", confidence: 0.95 },
  { name: "Shell", patterns: [/\bSHELL\b/], category: "Transportation > Fuel", confidence: 0.9 },
  { name: "Petro-Canada", patterns: [/\bPETRO[- ]?CAN/], category: "Transportation > Fuel", confidence: 0.95 },
  { name: "Esso", patterns: [/\bESSO\b/], category: "Transportation > Fuel", confidence: 0.95 },
  { name: "Ultramar", patterns: [/\bULTRAMAR\b/], category: "Transportation > Fuel", confidence: 0.95 },
  { name: "Air Canada", patterns: [/\bAIR CANADA\b/], category: "Business > Business travel", confidence: 0.95 },
  { name: "Bell", patterns: [/^BELL\b/, /\bBELL CANADA\b/, /\bBELL MOBILITY\b/], category: "Housing > Phone and internet", confidence: 0.85 },
  { name: "Rogers", patterns: [/\bROGERS\b/], category: "Housing > Phone and internet", confidence: 0.9 },
  { name: "Videotron", patterns: [/\bVIDEOTRON\b/], category: "Housing > Phone and internet", confidence: 0.95 },
  { name: "Telus", patterns: [/\bTELUS\b/], category: "Housing > Phone and internet", confidence: 0.95 },
  { name: "Fizz", patterns: [/\bFIZZ\b/], category: "Housing > Phone and internet", confidence: 0.9 },
  { name: "Ooma", patterns: [/\bOOMA\b/], category: "Housing > Phone and internet", confidence: 0.95 },
  { name: "Énergir", patterns: [/\bENERGIR\b/, /\bGAZ METRO\b/], category: "Housing > Utilities", confidence: 0.95 },
  { name: "Rona", patterns: [/\bRONA\b/], category: "Housing > Maintenance", confidence: 0.95 },
  { name: "UPS", patterns: [/^UPS\b/, /\bUPS STORE\b/], category: "Business > Delivery and postage", confidence: 0.9 },
  { name: "Hydro-Québec", patterns: [/\bHYDRO[- ]?QUEBEC\b/], category: "Housing > Utilities", confidence: 0.97 },
  { name: "Hydro One", patterns: [/\bHYDRO ONE\b/], category: "Housing > Utilities", confidence: 0.97 },
  { name: "PayPal", patterns: [/^PAYPAL\b/], category: "Other > Uncategorized", confidence: 0.6 },
];

const NOISE_PREFIXES = [
  /^(POS|IDP|INTERAC|VISA|MC|MASTERCARD|DEBIT|CREDIT)\s+(PURCHASE|DEBIT|CREDIT|ACHAT|PAYMENT)\s*/,
  /^(POINT OF SALE|PURCHASE|ACHAT|PAIEMENT|RETAIL PURCHASE|CONTACTLESS|TAP)\s*[-:]?\s*/,
  /^(PRE-?AUTH(ORIZED)?|PREAUTHORIZED)\s+(DEBIT|PAYMENT)\s*/,
  /^(SQ|TST|SP|PY|DD|PP|IN|CKO)\s?\*\s*/,
  /^PAYPAL\s?\*\s?(?=\w)/,
  /^(ANNULATION\s*-?\s*)?(INTERAC\s+)?(E-?TRANSFER|VIREMENT( INTERAC)?)\s+(SENT|RECEIVED|TO|FROM|ENVOYE|RECU|DE|A)?\s*\/?\s*/,
  /^PAIEMENT FACTURE\s*-?\s*(ACCESD( INTERNET)?)?\s*\/?\s*/,
  /^PAIEMENT DIRECT\s*-?\s*/,
];

const PROVINCES = "(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|YT|NT|NU|WA|NY|CA|TX|FL)";

/** Clean a raw bank descriptor into a stable comparison key. Never used for display. */
export function cleanDescriptor(raw: string): string {
  let s = raw.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  for (const p of NOISE_PREFIXES) s = s.replace(p, "");
  s = s
    .replace(/\*+[A-Z0-9]{4,}\b/g, " ") // *2K3LM9 order refs
    .replace(/#\s?\d+/g, " ") // store numbers
    .replace(/\b\d{4,}\b/g, " ") // long numbers, card refs
    .replace(/\bX{2,}\d+\b/g, " ")
    .replace(/\bWWW\./g, "")
    .replace(/\.(COM|CA|NET|IO|CO)\b/g, (m) => m) // keep domain tld for matching
    .replace(new RegExp(`\\s+[A-Z][A-Z'-]{2,20}\\s+${PROVINCES}$`), "") // trailing "CITY ON"
    .replace(new RegExp(`\\s+${PROVINCES}$`), "")
    .replace(/[^A-Z0-9&.' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s;
}

export interface MerchantMatch {
  name: string;
  key: string;
  confidence: number;
  source: "ALIAS" | "KNOWN" | "DERIVED";
  suggestedCategory?: string;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s&.'-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

/**
 * @param aliases user/system aliases: cleaned key -> merchant name. Exact key matches win.
 */
export function identifyMerchant(raw: string, aliases: Map<string, string> = new Map()): MerchantMatch {
  const key = cleanDescriptor(raw);
  const alias = aliases.get(key);
  if (alias) {
    const known = KNOWN_MERCHANTS.find((k) => k.name === alias && k.patterns.some((p) => p.test(key) || p.test(raw.toUpperCase())))
      ?? KNOWN_MERCHANTS.find((k) => k.name === alias);
    return { name: alias, key, confidence: 1, source: "ALIAS", suggestedCategory: known?.category };
  }

  const upper = raw.toUpperCase();
  for (const km of KNOWN_MERCHANTS) {
    if (km.patterns.some((p) => p.test(key) || p.test(upper))) {
      return { name: km.name, key, confidence: km.confidence ?? 0.9, source: "KNOWN", suggestedCategory: km.category };
    }
  }

  // Derived: first meaningful words of the key.
  const words = key.split(" ").filter((w) => w.length > 1 && !/^\d/.test(w));
  const name = titleCase(words.slice(0, 3).join(" ") || key || raw.trim());
  return { name, key, confidence: words.length ? 0.6 : 0.3, source: "DERIVED" };
}

/** Similarity of two descriptors (token overlap on cleaned keys), 0..1. */
export function descriptorSimilarity(a: string, b: string): number {
  const ta = new Set(cleanDescriptor(a).split(" ").filter(Boolean));
  const tb = new Set(cleanDescriptor(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  // Overlap coefficient: "STAPLES" vs "STAPLES STORE 112" is a strong match.
  return inter / Math.min(ta.size, tb.size);
}
