/** Default category tree seeded for each new user. Users can add unlimited categories. */
import type { CategoryKind } from "@prisma/client";

export interface DefaultCategory { name: string; kind: CategoryKind; code: string; tax?: string; children: string[] }

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Housing", kind: "EXPENSE", code: "5100", children: ["Mortgage", "Rent", "Property taxes", "Insurance", "Maintenance", "Renovations", "Utilities"] },
  { name: "Food", kind: "EXPENSE", code: "5200", children: ["Groceries", "Restaurants", "Coffee shops", "Food delivery"] },
  { name: "Transportation", kind: "EXPENSE", code: "5300", children: ["Car payments", "Fuel", "Insurance", "Parking", "Maintenance", "Public transit"] },
  { name: "Shopping", kind: "EXPENSE", code: "5400", children: ["Clothing", "Electronics", "Household products", "General merchandise"] },
  { name: "Family", kind: "EXPENSE", code: "5500", children: ["Childcare", "Education", "Children's activities", "Family essentials"] },
  { name: "Financial", kind: "EXPENSE", code: "5600", children: ["Banking fees", "Interest expenses", "Professional fees"] },
  { name: "Entertainment", kind: "EXPENSE", code: "5700", children: ["Subscriptions", "Streaming", "Travel", "Recreation"] },
  { name: "Business", kind: "EXPENSE", code: "5800", tax: "Generally deductible business expense", children: ["Software", "Marketing", "Professional services", "Office expenses", "Business travel"] },
  { name: "Other", kind: "EXPENSE", code: "5900", children: ["Miscellaneous", "Uncategorized"] },
  { name: "Income", kind: "INCOME", code: "4000", children: ["Sales and customer payments", "Interest income", "Other income"] },
  { name: "Money movement", kind: "NON_OPERATING", code: "1900", children: ["Transfers between my accounts", "Credit card payments", "Loan and mortgage payments", "Balance corrections"] },
];

export const DEFAULT_LEDGER = [
  { code: "1000", name: "Cash and bank accounts", type: "ASSET" as const },
  { code: "1900", name: "Inter-account clearing", type: "ASSET" as const },
  { code: "2100", name: "Credit cards payable", type: "LIABILITY" as const },
  { code: "2200", name: "Loans and lines of credit", type: "LIABILITY" as const },
  { code: "3000", name: "Owner's equity", type: "EQUITY" as const },
  { code: "4000", name: "Revenue", type: "INCOME" as const },
  ...DEFAULT_CATEGORIES.filter((c) => c.kind === "EXPENSE").map((c) => ({ code: c.code, name: c.name, type: "EXPENSE" as const })),
];
