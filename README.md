# LedgerIQ

Financial reconciliation and spending intelligence for business owners. Import bank and card
statements, and LedgerIQ combines supplier names, separates real spending from money moving
between your own accounts, reconciles statements, and explains each month in plain language.
Every total can be clicked through to the transactions behind it.

## What's in it

- **Five sections:** Overview, Spending, Accounts, Review, Reports. Accountant tools sit under
  *Advanced* and only appear in Accountant mode.
- **Statement import:** drag and drop CSV, Excel (.xlsx), OFX/QFX or PDF, including scanned PDFs.
  It recognises RBC, TD, CIBC, Desjardins, Scotiabank, BMO, National Bank and Amex layouts, and
  works out columns, date order and sign conventions for other banks. You see a preview and can fix
  rows, types, categories, signs and column mapping before anything is saved. The original file is
  kept, encrypted, for the audit trail.
- **Duplicate protection:** re-uploading a statement imports nothing twice. Near-matches are flagged
  for review and never deleted. A duplicate is only ever excluded from totals, and can be restored.
- **Supplier consolidation:** "AMZN MKTP CA", "AMAZON.CA" and "Amazon Marketplace" become
  *Amazon*, with confidence scores, learned aliases, rename and combine. Supplier and category are
  separate, so one supplier can cover several categories.
- **Categories:** a default tree you can extend. Classification order is your rules, then your past
  choices, then supplier defaults, known suppliers and description patterns. Your own choices are
  never overwritten.
- **Correct accounting treatment:** card payments, transfers and loan repayments are linked across
  accounts and never counted as spending. Refunds net against spending.
- **Reconciliation:** opening + inflows - outflows = closing, with the correct sign for credit cards
  and lines of credit. It explains likely causes of a difference, and offers audited balance
  corrections in Accountant mode.
- **Analytics:** month-over-month changes, rolling averages, year over year, recurring charges and
  price increases, unusual purchases, a heatmap, and statement coverage (which months are missing
  or partial).
- **Questions:** "How much did we spend on Amazon this year?" Answers come from database queries
  and link to their source transactions. Claude can optionally help interpret harder questions;
  it never produces the numbers.
- **Accountant mode:** general journal and trial balance from the same ledger, manual journal
  entries, chart of accounts with category mapping and tax treatment, splits, and the full audit log.
- **Currencies:** CAD and USD accounts keep their own currency. Conversion only uses exchange rates
  you enter. Without one, those amounts are left out of totals and the app tells you.

## Run it locally

Requirements: Node 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env          # set DATABASE_URL and ENCRYPTION_KEY (command to generate it is in the file)
npx prisma migrate deploy
npm run dev                   # http://localhost:3000
```

Create an account, add a bank account or card, then import a statement. Fictional sample
statements are in `samples/`.

Optional: set `ANTHROPIC_API_KEY` to let Claude interpret questions the built-in rules don't
understand.

## How PDFs are read

PDFs are read from their layout, not just their text. Each amount is matched to the column it sits
under (Withdrawals / Deposits / Amount / Balance, or Retrait / Dépôt / Solde), payee lines that
wrap onto a second line are joined, and every sign is checked against the printed running balance.
The reader also picks up the statement period, the opening and closing balances, and the account's
last four digits, so the statement can be reconciled straight after import.

Scanned (image-only) PDFs are rendered and read with Tesseract OCR, using English and French language
data bundled in `node_modules`, so no network access is needed. They then go through the same reader,
and the preview asks the user to confirm each amount. A two-page scan takes about 4 seconds. OCR is
optional at deploy time: if its packages are missing, the app says so and asks for a CSV or OFX.

## Tests

```bash
npm test                      # unit tests for the calculation engines
npm run build && INSECURE_COOKIES=1 npm start -- -p 3100 &
BASE_URL=http://localhost:3100 npm run test:e2e   # full browser workflow (Playwright)
```

The browser test registers a user, imports all four sample statements, re-imports one, and checks
totals against values computed independently from the files. It also checks drill-downs, transfer
linking, questions, review, reconciliation, duplicate exclude/restore, receipts, splits, supplier
combining, export, and the phone layout.

## Not included yet

- OCR on very poor scans (faxes, phone photos) will need manual corrections in the preview.
- Shared rate-limit storage. The sign-in limiter is per server process.
- Multi-user workspaces. Each login has its own books.
