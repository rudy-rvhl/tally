/** Default category tree seeded for each new user. Users can add unlimited categories. */
import type { CategoryKind } from "@prisma/client";

export interface DefaultCategory { name: string; kind: CategoryKind; code: string; tax?: string; children: string[] }

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Housing", kind: "EXPENSE", code: "5100", children: ["Mortgage", "Rent", "Property taxes", "Insurance", "Maintenance", "Renovations", "Utilities", "Phone and internet"] },
  { name: "Food", kind: "EXPENSE", code: "5200", children: ["Groceries", "Restaurants", "Coffee shops", "Food delivery"] },
  { name: "Transportation", kind: "EXPENSE", code: "5300", children: ["Car payments", "Fuel", "Insurance", "Parking", "Maintenance", "Public transit"] },
  { name: "Shopping", kind: "EXPENSE", code: "5400", children: ["Clothing", "Electronics", "Household products", "General merchandise"] },
  { name: "Family", kind: "EXPENSE", code: "5500", children: ["Childcare", "Education", "Children's activities", "Family essentials"] },
  { name: "Financial", kind: "EXPENSE", code: "5600", children: ["Banking fees", "Interest expenses", "Professional fees"] },
  { name: "Entertainment", kind: "EXPENSE", code: "5700", children: ["Subscriptions", "Streaming", "Travel", "Recreation"] },
  { name: "Business", kind: "EXPENSE", code: "5800", tax: "Generally deductible business expense", children: ["Software", "Marketing", "Professional services", "Office expenses", "Business travel", "Cleaning", "Delivery and postage"] },
  { name: "Other", kind: "EXPENSE", code: "5900", children: ["Miscellaneous", "Uncategorized"] },
  { name: "Income", kind: "INCOME", code: "4000", children: ["Rent", "Sales and customer payments", "Interest income", "Other income"] },
  { name: "Money movement", kind: "NON_OPERATING", code: "1900", children: ["Transfers between my accounts", "Credit card payments", "Loan and mortgage payments", "Balance corrections"] },
];

/**
 * Default codes for the "#" column of the exported bank book, following a common Quebec
 * small-business chart of accounts. Users can change any of them (Accountant View → Chart of accounts).
 */
export const DEFAULT_BOOK_CODES: Record<string, string> = {
  "Housing > Insurance": "5685",
  "Transportation > Insurance": "5685",
  "Financial > Banking fees": "5690",
  "Income > Interest income": "5690",
  "Business > Office expenses": "5700",
  "Transportation > Fuel": "5730",
  "Transportation > Parking": "5730",
  "Business > Delivery and postage": "5740",
  "Housing > Phone and internet": "5780",
  "Housing > Utilities": "5790",
  "Housing > Maintenance": "5845",
  "Housing > Renovations": "5845",
  "Business > Cleaning": "5865",
};

export const DEFAULT_LEDGER = [
  { code: "1000", name: "Cash and bank accounts", type: "ASSET" as const },
  { code: "1900", name: "Inter-account clearing", type: "ASSET" as const },
  { code: "2100", name: "Credit cards payable", type: "LIABILITY" as const },
  { code: "2200", name: "Loans and lines of credit", type: "LIABILITY" as const },
  { code: "3000", name: "Owner's equity", type: "EQUITY" as const },
  { code: "4000", name: "Revenue", type: "INCOME" as const },
  ...DEFAULT_CATEGORIES.filter((c) => c.kind === "EXPENSE").map((c) => ({ code: c.code, name: c.name, type: "EXPENSE" as const })),
];
