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

## PDF statements (`samples/pdf/`)

Regenerate them with `python3 samples/pdf/generate.py` (needs `reportlab`, plus Pillow and
`pdftoppm` for the scanned one).

| File | Layout |
|---|---|
| `chequing-withdrawals-deposits.pdf` | Bank chequing, Withdrawals / Deposits / Balance columns, 2 pages, payee on a second line |
| `credit-card-dec-jan.pdf` | Card with transaction and posting dates, `CR` and trailing-minus credits, Dec → Jan period |
| `amex-style.pdf` | Single Amount column, minus-sign credits, reference lines |
| `desjardins-francais.pdf` | French: RETRAIT / DÉPÔT / SOLDE, "02 OCT" dates, "1 234,56" amounts |
| `desjardins-multicomptes.pdf` | Desjardins business layout: code column, Frais / Retrait / Dépôt / Solde, a row whose amount is on its second line, page break with "(SUITE)", a second account section, and a mortgage section with Intérêt / Remboursement columns |
| `scanned-chequing.pdf` | Image-only (scanned) copy of the chequing statement, slightly tilted |
