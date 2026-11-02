# Sample statements (for testing only)

These files are **fictional** statements in the real export layouts of four
institutions. Use them to try the import flow or run the automated tests. They
are never loaded into the database automatically, and LedgerIQ never shows
sample data as if it were yours.

| File | Layout | Notes |
|---|---|---|
| `rbc-business-chequing-2026-08-to-10.csv` | RBC CSV export | Customer payouts, rent, utilities, card payments to Amex and Scotia Visa, loan payments |
| `amex-business-2026-08-to-10.csv` | American Express CSV (charges positive) | Amazon in five spellings, software subscriptions (Adobe price increase in Oct), a refund, payments |
| `scotiabank-visa-2026-09-to-10.ofx` | OFX (FITIDs) | Closing balance owed $1,076.06. Opening balance owed on Sep 1 is $3,136.55 |
| `td-personal-chequing-2026-10.csv` | TD headerless CSV | Contains two identical Tim Hortons charges on the same day (both real) |

Reconciling the Scotiabank Visa statement (balance owed):
$3,136.55 opening + $589.51 charges − $2,650.00 payments = $1,076.06 closing.
