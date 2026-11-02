# LedgerIQ

Financial reconciliation and spending intelligence for business owners: import bank and card
statements, combine supplier names automatically, reconcile statements, and see plain-language
monthly summaries. Every total can be clicked through to its transactions.

## Run it locally

Requirements: Node 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env          # set DATABASE_URL and ENCRYPTION_KEY (command to generate it is in the file)
npx prisma migrate deploy
npm run dev                   # http://localhost:3000
```

Create an account, add a bank account or card, then import a statement. Fictional sample
statements to try are in `samples/`.

Optional: set `ANTHROPIC_API_KEY` to let AI interpret harder questions in the search bar.
Amounts are always computed from database queries, never by the model.

## Tests

```bash
npm test                      # engine unit tests
npm run build && INSECURE_COOKIES=1 npm start -- -p 3100 &
BASE_URL=http://localhost:3100 npm run test:e2e   # browser workflow test (Playwright)
```
