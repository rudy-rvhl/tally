"""Generate fictional PDF statements in common Canadian layouts, for testing PDF import.
Run: python3 samples/pdf/generate.py   (requires reportlab)
"""
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent
W, H = letter

def money(v, fr=False):
    s = f"{abs(v):,.2f}"
    if fr:
        s = s.replace(",", " ").replace(".", ",")
    return s

def chequing():
    """Bank-style chequing: Date | Description | Withdrawals | Deposits | Balance, 2 pages, wrapped descriptions."""
    c = canvas.Canvas(str(OUT / "chequing-withdrawals-deposits.pdf"), pagesize=letter)
    rows = [
        ("Oct 1", ["Opening balance"], None, None, 5000.00),
        ("Oct 2", ["Online Banking payment - 5521", "HYDRO-QUEBEC"], 196.40, None, None),
        ("Oct 3", ["Rent 4521 St-Laurent"], 2400.00, None, None),
        ("Oct 6", ["Deposit STRIPE PAYOUT"], None, 7390.00, None),
        ("Oct 9", ["e-Transfer sent", "J TREMBLAY DESIGN"], 900.00, None, None),
        ("Oct 12", ["Loan payment business loan"], 850.00, None, None),
    ]
    rows2 = [
        ("Oct 20", ["Payment AMEX card"], 3118.62, None, None),
        ("Oct 22", ["Misc payment", "SCOTIA VISA PAYMENT"], 1450.00, None, None),
        ("Oct 27", ["Deposit STRIPE PAYOUT"], None, 6155.00, None),
        ("Oct 31", ["Monthly fee"], 19.95, None, None),
    ]
    bal = 5000.00
    def header(y, page):
        c.setFont("Helvetica-Bold", 14); c.drawString(50, H - 50, "Royal Bank of Canada")
        c.setFont("Helvetica", 9)
        c.drawString(50, H - 66, "Business Account Statement   Account number: 00012-1004567")
        c.drawString(50, H - 78, "From October 1, 2026 to October 31, 2026")
        c.drawRightString(W - 50, H - 50, f"Page {page} of 2")
        c.setFont("Helvetica-Bold", 9)
        c.drawString(50, y, "Date"); c.drawString(100, y, "Description")
        c.drawRightString(390, y, "Withdrawals ($)"); c.drawRightString(470, y, "Deposits ($)"); c.drawRightString(560, y, "Balance ($)")
        c.setFont("Helvetica", 9)
    def draw(rows, y):
        nonlocal bal
        for d, desc, wd, dep, b in rows:
            if b is None:
                bal = round(bal - (wd or 0) + (dep or 0), 2)
            c.drawString(50, y, d); c.drawString(100, y, desc[0])
            if wd: c.drawRightString(390, y, money(wd))
            if dep: c.drawRightString(470, y, money(dep))
            c.drawRightString(560, y, money(bal))
            for extra in desc[1:]:
                y -= 12; c.drawString(100, y, extra)
            y -= 16
        return y
    header(H - 110, 1)
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 95, "Summary: Opening balance $5,000.00   Total deposits $13,545.00   Total withdrawals $8,934.97   Closing balance $9,610.03")
    draw(rows, H - 128)
    c.drawString(50, 60, "Please check this statement carefully. Continued on next page.")
    c.showPage()
    header(H - 110, 2)
    y = draw(rows2, H - 128)
    c.setFont("Helvetica-Bold", 9); c.drawString(100, y, "Closing balance"); c.drawRightString(560, y, money(bal))
    c.save()
    assert abs(bal - 9610.03) < 0.001, bal

def card():
    """Credit card: Trans date | Post date | Description | Amount, CR credits, period crossing the year."""
    c = canvas.Canvas(str(OUT / "credit-card-dec-jan.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 14); c.drawString(50, H - 50, "Scotiabank Visa Business Card")
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 66, "Account XXXX XXXX XXXX 8812")
    c.drawString(50, H - 78, "Statement period Dec 16, 2025 - Jan 15, 2026")
    c.drawString(50, H - 100, "Previous balance $1,234.56")
    c.drawString(50, H - 112, "New balance $1,021.08")
    c.drawString(300, H - 100, "Minimum payment $10.00      Payment due date Feb 5, 2026")
    y = H - 140
    c.setFont("Helvetica-Bold", 9)
    for x, t in [(50, "TRANS. DATE"), (120, "POST DATE"), (190, "DESCRIPTION")]: c.drawString(x, y, t)
    c.drawRightString(560, y, "AMOUNT ($)")
    c.setFont("Helvetica", 9)
    rows = [("Dec 18", "Dec 19", "AMAZON.CA AMAZON.CA ON", "45.21"), ("Dec 22", "Dec 23", "PETRO-CANADA 2231 MONTREAL QC", "61.12"),
            ("Dec 28", "Dec 28", "PAYMENT - THANK YOU", "1,234.56 CR"), ("Jan 3", "Jan 4", "ADOBE *CREATIVE CLOUD", "39.99"),
            ("Jan 8", "Jan 9", "AMAZON.CA RETURN", "45.21-"), ("Jan 10", "Jan 11", "COSTCO WHOLESALE W512", "919.97")]
    for r in rows:
        y -= 16
        c.drawString(50, y, r[0]); c.drawString(120, y, r[1]); c.drawString(190, y, r[2]); c.drawRightString(560, y, r[3])
    y -= 24; c.drawString(190, y, "Interest charged on purchases"); c.drawRightString(560, y, "0.00")
    c.save()

def amex():
    """Amex-like: date, description, amount; credits with a leading minus; reference on a second line."""
    c = canvas.Canvas(str(OUT / "amex-style.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 14); c.drawString(50, H - 50, "American Express Business Gold Card")
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 66, "Closing Date Oct 31, 2026      Account Ending 1004")
    c.drawString(50, H - 78, "Opening Date Oct 1, 2026")
    c.drawString(50, H - 96, "Previous Balance $2,645.10      New Balance $1,337.18")
    y = H - 124
    c.setFont("Helvetica-Bold", 9); c.drawString(50, y, "Date"); c.drawString(110, y, "Description"); c.drawRightString(560, y, "Amount")
    c.setFont("Helvetica", 9)
    rows = [("Oct 02", "AMAZON MARKETPLACE", "Reference 320261234567", "$120.00"), ("Oct 03", "ADOBE *CREATIVE CLOUD", None, "$39.99"),
            ("Oct 12", "AIR CANADA 0142356", "MONTREAL QC", "$642.18"), ("Oct 13", "AMAZON.CA", None, "-$64.99"),
            ("Oct 20", "PAYMENT RECEIVED - THANK YOU", None, "-$2,645.10"), ("Oct 21", "META PLATFORMS ADS", None, "$600.00")]
    for d, desc, sub, amt in rows:
        y -= 16
        c.drawString(50, y, d); c.drawString(110, y, desc); c.drawRightString(560, y, amt)
        if sub: y -= 11; c.setFont("Helvetica", 7.5); c.drawString(110, y, sub); c.setFont("Helvetica", 9)
    c.save()

def desjardins_fr():
    """French layout: DATE | DESCRIPTION | RETRAIT | DÉPÔT | SOLDE, '02 OCT' dates, '1 234,56' amounts."""
    c = canvas.Canvas(str(OUT / "desjardins-francais.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 14); c.drawString(50, H - 50, "Desjardins - Relevé de compte")
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 66, "Période du 1 octobre 2026 au 31 octobre 2026      Folio ***4410")
    y = H - 100
    c.setFont("Helvetica-Bold", 9)
    c.drawString(50, y, "DATE"); c.drawString(110, y, "DESCRIPTION")
    c.drawRightString(400, y, "RETRAIT"); c.drawRightString(480, y, "DÉPÔT"); c.drawRightString(560, y, "SOLDE")
    c.setFont("Helvetica", 9)
    bal = 1250.00
    y -= 16; c.drawString(50, y, "01 OCT"); c.drawString(110, y, "Solde reporté"); c.drawRightString(560, y, money(bal, True))
    for d, desc, wd, dep in [("02 OCT", "Achat IGA EXTRA #8123", 87.45, None), ("05 OCT", "Dépôt paie", None, 2310.50),
                              ("15 OCT", "Paiement facture VIDEOTRON", 104.83, None), ("28 OCT", "Frais mensuels", 7.95, None)]:
        bal = round(bal - (wd or 0) + (dep or 0), 2)
        y -= 16; c.drawString(50, y, d); c.drawString(110, y, desc)
        if wd: c.drawRightString(400, y, money(wd, True))
        if dep: c.drawRightString(480, y, money(dep, True))
        c.drawRightString(560, y, money(bal, True))
    c.save()

def desjardins_multi():
    """Desjardins business layout: code column, Frais/Retrait/Dépôt/Solde, a row whose amount is on its
    second line, page break with (SUITE), a second account section, and a mortgage (PRET) section."""
    c = canvas.Canvas(str(OUT / "desjardins-multicomptes.pdf"), pagesize=letter)
    X = dict(date=40, code=75, desc=110, frais=355, retrait=425, depot=495, solde=572)
    def letterhead(page):
        c.setFont("Helvetica", 8)
        for i, t in enumerate(["CAISSE DESJARDINS", "DES ENTREPRENEURS", "1000 RUE EXEMPLE", "MONTREAL, QC"]): c.drawString(70, H - 40 - i * 10, t)
        c.drawString(430, H - 50, "Pour la période"); c.drawString(400, H - 62, "du 1er octobre au 31 octobre 2026")
        c.drawString(330, H - 74, "Folio"); c.drawString(430, H - 86, "123456"); c.drawString(500, H - 86, f"Page {page} de 2")
        c.setFont("Helvetica-Bold", 9); c.drawCentredString(W / 2, H - 110, "RELEVÉ DE COMPTE")
        c.setFont("Helvetica", 8); c.drawString(60, H - 135, "EXEMPLE IMMOBILIER INC.")
    def header(y, title):
        c.setFont("Helvetica-Bold", 8); c.drawCentredString(W / 2 + 40, y + 12, title)
        c.drawString(X["date"], y, "Date"); c.drawString(X["code"], y, "Code"); c.drawString(X["desc"] + 60, y, "Description")
        c.drawRightString(X["frais"], y, "Frais"); c.drawRightString(X["retrait"], y, "Retrait"); c.drawRightString(X["depot"], y, "Dépôt"); c.drawRightString(X["solde"], y, "Solde")
        c.setFont("Helvetica", 8)
    def fr(v): return f"{v:,.2f}".replace(",", " ")
    bal = 20000.00
    def row(y, d, code, desc, kind=None, amt=None, wrap=None):
        nonlocal bal
        c.drawString(X["date"], y, d); c.drawString(X["code"], y, code); c.drawString(X["desc"], y, desc)
        if wrap:  # amount printed on the second line
            y -= 10; c.drawString(X["desc"], y, wrap)
        if kind:
            bal = round(bal + (amt if kind == "depot" else -amt), 2)
            c.drawRightString(X[kind], y, fr(amt)); c.drawRightString(X["solde"], y, fr(bal))
        return y - 12
    letterhead(1)
    y = H - 175; header(y, "EOP EPARGNE AVEC OPERATIONS (C)"); y -= 12
    c.drawString(X["desc"] + 5, y, "Solde reporté"); c.drawRightString(X["solde"], y, fr(bal)); y -= 12
    y = row(y, " 1 OCT", "VRW", "Virement Interac de / LOCATAIRE UN /", "depot", 1250.00)
    y = row(y, " 1 OCT", "VRW", "Virement Interac de / LOCATAIRE DEUX/", "depot", 1100.00)
    y = row(y, " 1 OCT", "PWW", "Paiement facture - AccèsD Internet / AMERICAN EXP", "retrait", 845.30, wrap="CARD")
    y = row(y, " 3 OCT", "VNW", "Virement Interac à / ENTREPRENEUR ABC/", "retrait", 600.00)
    y = row(y, " 3 OCT", "VNW", "Annulation - Virement Interac à / ENTREPRENEUR ABC/", "depot", 600.00)
    y = row(y, " 7 OCT", "DMD", "Dépôt Mobile", "depot", 975.00)
    c.showPage(); letterhead(2)
    y = H - 175; header(y, "EOP EPARGNE AVEC OPERATIONS (C) (SUITE)"); y -= 12
    y = row(y, "16 OCT", "VAP", "Virement-remboursement / à PR 1", "retrait", 4200.00)
    y = row(y, "20 OCT", "PWW", "Paiement facture - AccèsD Internet / HYDRO-QUEBEC", "retrait", 312.45)
    y = row(y, "30 OCT", "FIX", "Frais fixes d'utilisation", "frais", 5.95)
    eop_close = bal
    # second account section
    y -= 14; header(y, "COMPTE D'EPARGNE ET DE PLACEMENT"); y -= 12
    c.drawString(X["date"], y, "CS"); c.drawString(X["code"] + 20, y, "PART DE QUALIFICATION (A)"); y -= 12
    bal = 5.00; c.drawString(X["desc"] + 5, y, "Solde reporté"); c.drawRightString(X["solde"], y, fr(bal)); y -= 12
    y = row(y, "31 OCT", "INT", "Intérêts", "depot", 0.05)
    # mortgage section
    y -= 14; c.setFont("Helvetica-Bold", 8); c.drawCentredString(W / 2 + 40, y + 12, "PRET")
    c.drawString(X["date"], y, "Date"); c.drawString(X["code"], y, "Code"); c.drawString(X["desc"] + 60, y, "Description")
    c.drawRightString(X["frais"], y, "Intérêt"); c.drawRightString(X["retrait"] + 15, y, "Capital versé"); c.drawRightString(X["depot"] + 15, y, "Remboursement"); c.drawRightString(X["solde"], y, "Solde")
    c.setFont("Helvetica", 8); y -= 12
    c.drawString(X["date"], y, "PR 1"); c.drawString(X["code"] + 20, y, "PRET HYPOTHECAIRE (MULTILOGEMENTS)"); y -= 12
    c.drawString(X["desc"] + 5, y, "Solde reporté"); c.drawRightString(X["solde"], y, fr(1200000.00)); y -= 12
    c.drawString(X["date"], y, "16 OCT"); c.drawString(X["code"], y, "CT"); c.drawString(X["desc"], y, "Remboursement automatique / de EOP: 4 200.00 $")
    c.drawRightString(X["frais"], y, fr(3460.00)); c.drawRightString(X["depot"] + 15, y, fr(740.00)); c.drawRightString(X["solde"], y, fr(1199260.00)); y -= 12
    c.drawString(X["desc"] - 50, y, "Date d'échéance du terme: 7 octobre 2030    Taux d'intérêt en vigueur: 3.460 % l'an")
    c.save()
    assert abs(eop_close - 17961.30) < 0.001, eop_close

def scanned():
    """Image-only copy of the chequing statement, like a scan: rendered with pdftoppm, slightly rotated."""
    import shutil, subprocess, tempfile
    from PIL import Image
    if not shutil.which("pdftoppm"):
        print("pdftoppm not found; skipping scanned sample"); return
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", "150", "-gray", "-png", str(OUT / "chequing-withdrawals-deposits.pdf"), f"{tmp}/p"], check=True)
        pages = [Image.open(p).convert("L").rotate(0.4, fillcolor=255, expand=False) for p in sorted(Path(tmp).glob("p-*.png"))]
        pages[0].save(OUT / "scanned-chequing.pdf", save_all=True, append_images=pages[1:], resolution=150)

def scotia(file, kind, acct, start, end, opening, rows, totals):
    """Scotiabank business layout: date column (MMDD) to the RIGHT of the amounts, printed only on the
    last transaction of each day together with the balance; 3-line descriptions; page 2 is a fee table."""
    c = canvas.Canvas(str(OUT / file), pagesize=letter)
    T = lambda y: H - y  # positions measured from the top, like the real statement
    def page_top(page, label):
        c.setFont("Courier", 8)
        c.drawString(67, T(56), "100 RUE EXEMPLE"); c.drawString(271, T(56), "10001 31")
        c.drawString(67, T(65), "MONTREAL QC H2X 1A1")
        c.drawString(67, T(130), "SBDDA40000_0000001_002 E D 10001"); c.drawString(193, T(130), "00001")
        c.drawString(67, T(139), "EXEMPLE IMMOBILIER INC"); c.drawString(67, T(148), "200 AV DES EXEMPLES")
        c.drawString(67, T(166), "MONTREAL QC"); c.drawString(67, T(175), "H2X 1A1")
        c.drawString(532, T(155), "ACCOUNT NUMBER"); c.drawString(525, T(166), acct)
        c.drawString(84, T(214), "STATEMENT OF"); c.drawString(372, T(214), "FROM"); c.drawString(480, T(214), "TO"); c.drawString(578, T(214), "PAGE")
        c.drawString(84, T(228), label); c.drawString(372, T(228), start); c.drawString(480, T(228), end); c.drawString(590, T(228), str(page))
        c.drawString(461, T(237), "DATE")
        c.drawString(136, T(240), "DESCRIPTION"); c.drawString(261, T(240), "WITHDRAWALS/DEBITS"); c.drawString(371, T(240), "DEPOSITS/CREDITS"); c.drawString(526, T(240), "BALANCE")
        c.drawString(459, T(246), "M"); c.drawString(475, T(246), "D")
        c.drawString(67, T(779), "GST REGISTRATION NO. R000000000"); c.drawString(300, T(779), "Registered trademark of The Bank of Nova Scotia")
    page_top(1, kind)
    y = 258
    c.drawString(72, T(y), "BALANCE FORWARD"); c.drawString(459, T(y), start_md(start)); c.drawRightString(595, T(y), f"{opening:.2f}")
    bal = opening
    for desc, amt, md in rows:
        y += 11
        bal = round(bal + amt, 2)
        c.drawString(72, T(y), desc[0])
        if amt < 0: c.drawRightString(353, T(y), f"{-amt:.2f}")
        else: c.drawRightString(448, T(y), f"{amt:.2f}")
        if md: c.drawString(459, T(y), md); c.drawRightString(595, T(y), f"{bal:.2f}")
        for extra in desc[1:]:
            y += 11; c.drawString(78, T(y), extra)
    c.drawString(41, T(y + 11), "*119000000*")
    c.drawString(72, T(y + 33), '"UNCOLLECTED FEES AND/OR ODI OWING: $0.00"')
    c.drawString(88, T(714), "NO. OF"); c.drawString(291, T(714), "NO. OF"); c.drawString(494, T(714), "NO. OF"); c.drawString(545, T(714), "MORE ITEMS")
    c.drawString(163, T(718), "TOTAL AMOUNT - DEBITS"); c.drawString(357, T(718), "TOTAL AMOUNT - CREDITS")
    c.drawString(89, T(723), "DEBITS"); c.drawString(290, T(723), "CREDITS"); c.drawString(485, T(723), "ENCLOSURES"); c.drawString(551, T(723), "ON PAGE")
    nd, td, nc, tc = totals
    c.drawString(125, T(742), str(nd)); c.drawRightString(278, T(742), f"{td:,.2f}"); c.drawString(321, T(742), str(nc)); c.drawRightString(466, T(742), f"{tc:,.2f}"); c.drawString(588, T(742), "2")
    c.showPage()
    page_top(2, "SERVICE CHARGE")
    c.drawString(115, T(263), "ITEM"); c.drawString(286, T(263), "VOLUME"); c.drawString(382, T(263), "RATE"); c.drawString(532, T(263), "CHARGE")
    c.drawString(61, T(279), "SBAP MONTHLY FEE - FULL"); c.drawString(313, T(279), "25"); c.drawRightString(595, T(279), "20.00")
    c.drawString(61, T(301), "TOTAL SERVICE CHARGES"); c.drawRightString(595, T(301), "20.00")
    c.save()

def start_md(label):
    months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
    m, d, _ = label.split()
    return f"{months.index(m) + 1:02d}{int(d):02d}"

def scotia_all():
    etr = lambda ref: ["CREDIT MEMO", ref, "FREE INTERAC E-TRANSFER"]
    scotia("scotia-business-2026-09.pdf", "BUSINESS ACCOUNT", "10001 00098 76", "AUG 31 2026", "SEP 29 2026", 3200.00, [
        (etr("70000001"), 1250.00, None),
        (etr("70000002"), 980.00, "0905"),
        (["INSURANCE", "ARCHIVE+8", "EXEMPLE ASSURANCES", "MUTUELLE"], -365.40, "0915"),
        (["BILL PAYMENT", "HYDRO-QUEBEC"], -142.18, "0918"),
        (etr("70000003"), 1100.00, None),
        (["SERVICE CHARGE"], -20.00, "0929"),
    ], (3, 527.58, 3, 3330.00))
    scotia("scotia-business-2026-10.pdf", "BUSINESS ACCOUNT", "10001 00098 76", "SEP 30 2026", "OCT 30 2026", 6002.42, [
        (["DEPOSIT", "MOBILE CHEQUE"], 2400.00, "1001"),
        (["PC BILL PAYMENT", "SCOTIA VISA"], -800.00, None),
        (["TRANSFER TO", "00054 32"], -1000.00, "1015"),
        (["POS PURCHASE", "RONA #12345"], -215.37, "1020"),
        (["SERVICE CHARGE"], -20.00, "1030"),
    ], (4, 2035.37, 1, 2400.00))
    scotia("scotia-savings-2026-10.pdf", "BUSINESS SAVINGS ACCOUNT", "10001 00054 32", "SEP 30 2026", "OCT 30 2026", 10000.00, [
        (["TRANSFER FROM", "00098 76"], 1000.00, "1015"),
        (["INTEREST"], 4.12, "1030"),
    ], (0, 0.00, 2, 1004.12))

def scotia_visa():
    """Scotiabank credit card layout: each row starts with a reference number, then the transaction
    and posting dates; credits have a trailing minus ("500.00-")."""
    c = canvas.Canvas(str(OUT / "scotia-visa-2026-09.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 13); c.drawString(50, H - 50, "Scotiabank")
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 66, "Scotia Momentum VISA Infinite card")
    c.drawString(50, H - 78, "Account # 4537 XXXX XXXX 2468")
    c.drawString(330, H - 66, "Statement Period Aug 13, 2026 - Sep 12, 2026")
    c.drawString(330, H - 78, "Statement date Sep 12, 2026")
    c.drawString(50, H - 100, "Previous balance $642.18     Payments/credits -$642.18     Purchases/charges +$405.06")
    c.drawString(50, H - 112, "New Balance $405.06     Minimum payment $10.00     Payment due date Oct 6, 2026")
    y = H - 145
    c.setFont("Helvetica-Bold", 8)
    c.drawString(50, y, "REF.#"); c.drawString(90, y, "TRANS. DATE"); c.drawString(150, y, "POST DATE"); c.drawString(210, y, "DETAILS"); c.drawRightString(560, y, "AMOUNT($)")
    c.setFont("Helvetica", 8)
    rows = [
        ("001", "Aug 14", "Aug 15", "PAYMENT FROM - *****01*2345", "642.18-"),
        ("002", "Aug 16", "Aug 17", "RONA #12345 MONTREAL QC", "215.37"),
        ("003", "Aug 22", "Aug 23", "HYDRO-QUEBEC MONTREAL QC", "142.18"),
        ("004", "Sep 3", "Sep 4", "AMAZON.CA*AB12C AMAZON.CA ON", "64.99"),
        ("005", "Sep 8", "Sep 9", "RETURN AMAZON.CA ON", "17.48-"),
    ]
    for ref, t, p_, d, a in rows:
        y -= 14
        c.drawString(50, y, ref); c.drawString(90, y, t); c.drawString(150, y, p_); c.drawString(210, y, d); c.drawRightString(560, y, a)
    y -= 20; c.drawString(210, y, "SUB-TOTAL CREDITS"); c.drawRightString(560, y, "659.66-")
    y -= 14; c.drawString(210, y, "SUB-TOTAL DEBITS"); c.drawRightString(560, y, "422.54")
    c.save()

def unusual():
    """No column headings we know, dates in the middle of the line, amount then running balance."""
    c = canvas.Canvas(str(OUT / "unusual-layout.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 12); c.drawString(50, H - 50, "Caisse Exemple - Activity report")
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 70, "Opening balance 2,000.00")
    y = H - 100
    c.setFont("Helvetica-Bold", 9); c.drawString(50, y, "Item"); c.drawString(250, y, "When"); c.drawRightString(450, y, "Value"); c.drawRightString(540, y, "Running")
    c.setFont("Helvetica", 9)
    bal = 2000.00
    for item, when, v in [("Office rent", "2026-09-01", -1200.00), ("Client payment INV-104", "2026-09-05", 2500.00), ("Bell Canada", "2026-09-12", -95.40), ("Bank fee", "2026-09-30", -12.50)]:
        y -= 16; bal = round(bal + v, 2)
        c.drawString(50, y, item); c.drawString(250, y, when); c.drawRightString(450, y, f"{abs(v):,.2f}"); c.drawRightString(540, y, f"{bal:,.2f}")
    c.save()

def scotia_personal():
    """Scotiabank personal-style layout: a summary box with balances at the top, "Amounts withdrawn /
    deposited" headings, balance lines inside the table (opening, carried/brought forward, closing)."""
    c = canvas.Canvas(str(OUT / "scotia-chequing-balances.pdf"), pagesize=letter)
    def top(page):
        c.setFont("Helvetica-Bold", 13); c.drawString(50, H - 50, "Scotiabank")
        c.setFont("Helvetica", 9)
        c.drawString(50, H - 66, "Basic Bank Account   Account number 12345 00011 22")
        c.drawString(400, H - 66, f"Page {page} of 2")
    def header(y):
        c.setFont("Helvetica-Bold", 8)
        c.drawString(50, y, "Date"); c.drawString(100, y, "Transactions")
        c.drawRightString(380, y, "Amounts withdrawn ($)"); c.drawRightString(470, y, "Amounts deposited ($)"); c.drawRightString(560, y, "Balance ($)")
        c.setFont("Helvetica", 8)
    top(1)
    c.drawString(50, H - 90, "Here's what happened in your account")
    c.drawString(50, H - 104, "Opening balance on Aug 31, 2026"); c.drawRightString(300, H - 104, "$1,500.00")
    c.drawString(50, H - 116, "Minus total withdrawals"); c.drawRightString(300, H - 116, "$1,045.40")
    c.drawString(50, H - 128, "Plus total deposits"); c.drawRightString(300, H - 128, "$2,200.00")
    c.drawString(50, H - 140, "Closing balance on Sep 30, 2026"); c.drawRightString(300, H - 140, "= $2,654.60")
    y = H - 170; header(y)
    def row(d, desc, out=None, inn=None, bal=None):
        nonlocal y
        y -= 13
        if d: c.drawString(50, y, d)
        c.drawString(100, y, desc)
        if out: c.drawRightString(380, y, f"{out:,.2f}")
        if inn: c.drawRightString(470, y, f"{inn:,.2f}")
        if bal is not None: c.drawRightString(560, y, f"{bal:,.2f}")
    row("Aug 31", "Opening Balance", bal=1500.00)
    row("Sep 2", "Payroll Deposit EXEMPLE INC", inn=2200.00, bal=3700.00)
    row("Sep 5", "Bill Payment BELL CANADA", out=95.40, bal=3604.60)
    row(None, "Balance carried forward", bal=3604.60)
    c.showPage()
    top(2); y = H - 100; header(y)
    row(None, "Balance brought forward", bal=3604.60)
    row("Sep 15", "MB-Transfer to 00011 33", out=900.00, bal=2704.60)
    row("Sep 30", "Service Charge", out=50.00, bal=2654.60)
    row("Sep 30", "Closing Balance", bal=2654.60)
    c.save()

def scotia_fr_placements():
    """Banque Scotia, French business investment account: "REPORT" is the balance brought forward,
    headings with accents, a fee table on page 2 and a daily interest calculation table on pages 3-4."""
    c = canvas.Canvas(str(OUT / "scotia-fr-placements-2025-07.pdf"), pagesize=letter)
    T = lambda y: H - y
    acct = "10001 00055 77"
    def top(page, label, start="juin 30 2025"):
        c.setFont("Helvetica", 8)
        c.drawString(18, T(63), "100 RUE EXEMPLE 10001"); c.drawString(18, T(76), "MONTREAL QC H2X 1A1")
        c.drawString(18, T(112), "EXEMPLE PLACEMENTS INC"); c.drawString(18, T(125), "200 AV DES EXEMPLES")
        c.drawString(18, T(164), "Relevé de:"); c.drawString(162, T(164), "Numéro de compte:"); c.drawString(306, T(164), "De:"); c.drawString(450, T(164), "À:")
        c.drawString(18, T(177), label); c.drawString(162, T(177), acct); c.drawString(306, T(177), start); c.drawString(450, T(177), "juil. 31 2025")
        c.drawString(552, T(752), f"{page} de 4")
    def summary(y):
        c.drawString(18, T(y), "Nombre de débits"); c.drawString(162, T(y), "Total - Débits"); c.drawString(306, T(y), "Nombre de crédits"); c.drawString(450, T(y), "Total - Crédits")
        c.drawString(18, T(y + 12), "3"); c.drawString(162, T(y + 12), "$25,002.50"); c.drawString(306, T(y + 12), "1"); c.drawString(450, T(y + 12), "$812.45")
    top(1, "Compte d'entreprise")
    c.drawString(18, T(206), "Sommaire du compte pour cette période:"); summary(233)
    c.drawString(20, T(276), "Détails du compte:")
    c.drawString(18, T(292), "Date"); c.drawString(90, T(292), "Description"); c.drawString(301, T(292), "Retraits/Débits ($)"); c.drawString(409, T(292), "Dépôts/Crédits ($)"); c.drawString(556, T(292), "Solde ($)")
    y = 318
    def row(d, lines, out=None, inn=None, bal=None):
        nonlocal y
        c.drawString(18, T(y), d); c.drawString(90, T(y), lines[0])
        if out: c.drawRightString(388, T(y), f"{out:.2f}")
        if inn: c.drawRightString(490, T(y), f"{inn:.2f}")
        c.drawRightString(590, T(y), f"{bal:,.2f}")
        for extra in lines[1:]:
            y += 12.5; c.drawString(95, T(y), extra)
        y += 12.5
    row("06/30/2025", ["REPORT"], bal=250000.00)
    row("07/11/2025", ["VIR. TELEGRAP. TRANSMIS", "EXEMPLE PLACEMENTS INC", "TELEVIREMENT"], out=20000.00, bal=230000.00)
    row("07/17/2025", ["VIR. TELEGRAP. TRANSMIS", "SOCIETE EXEMPLE", "TELEVIREMENT"], out=5000.00, bal=225000.00)
    row("07/31/2025", ["INTERETS CREDITEURS"], inn=812.45, bal=225812.45)
    row("07/31/2025", ["FRAIS DE GESTION"], out=2.50, bal=225809.95)
    summary(y + 14)
    c.drawString(18, T(y + 52), "Fr non perçus et/ou int sur déc dus:"); c.drawString(572, T(y + 52), "0.00$")
    c.drawString(20, T(y + 90), "Veuillez vous reporter aux conditions énoncées dans le Contrat de services financiers de la Banque Scotia.")
    c.showPage()
    top(2, "Frais de service")
    c.drawString(20, T(202), "Effet"); c.drawString(347, T(202), "Volume"); c.drawString(467, T(202), "Taux"); c.drawString(557, T(202), "Frais ($)")
    c.drawString(20, T(225), "Commiss. sur opérations")
    c.drawString(25, T(238), "Autres opér. de débit"); c.drawString(375, T(238), "2"); c.drawString(470, T(238), "1.25"); c.drawString(575, T(238), "2.50")
    c.drawString(20, T(251), "Somme partielle"); c.drawString(575, T(251), "2.50")
    c.drawString(20, T(274), "Total des frais de gestion"); c.drawString(570, T(274), "$2.50")
    c.showPage()
    for page in (3, 4):
        top(page, "Intérêts sur dépôt", "juil. 01 2025")
        if page == 3:
            c.drawString(18, T(201), "Indications"); c.drawString(18, T(226), "Monnaie: CAD"); c.drawString(18, T(249), "Compte de placements d'entreprise")
            c.drawString(18, T(295), "Taux d'intérêt applicable:"); c.drawString(18, T(307), "Solde intégral")
        hy = 349 if page == 3 else 160
        c.drawString(18, T(hy), "Date"); c.drawString(211, T(hy), "Solde fermeture ($)"); c.drawString(378, T(hy), "Rndmt/Taux"); c.drawString(546, T(hy), "Intérêts ($)")
        days = range(1, 25) if page == 3 else range(25, 32)
        for i, d in enumerate(days):
            yy = hy + 23 + i * 12.6
            bal = 250000.00 if d < 11 else 230000.00 if d < 17 else 225000.00
            c.drawString(18, T(yy), f"07/{d:02d}/2025"); c.drawString(240, T(yy), f"{bal:,.2f}"); c.drawString(408, T(yy), "3.077"); c.drawString(565, T(yy), "21.08")
        if page == 4:
            c.drawString(18, T(hy + 23 + 7 * 12.6 + 20), "Total des intérêts"); c.drawString(551, T(hy + 23 + 7 * 12.6 + 20), "$812.45")
            c.drawString(205, T(hy + 23 + 7 * 12.6 + 44), f"Porté au crédit de votre compte {acct}.")
        c.showPage()
    c.save()

def stessa_rent_roll():
    """Rent roll report laid out like Stessa's "Rent Roll for All Properties" (landscape, fictional tenants)."""
    from reportlab.lib.pagesizes import landscape
    W2, H2 = landscape(letter)
    c = canvas.Canvas(str(OUT / "rent-roll-stessa.pdf"), pagesize=landscape(letter))
    T = lambda y: H2 - y
    c.setFont("Helvetica-Bold", 13); c.drawString(39, T(42), "Rent Roll for All Properties")
    c.setFont("Helvetica", 9); c.drawString(58, T(59), "As of October 31, 2026")
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(93, T(88), "Bed /"); c.drawString(553, T(88), "Balance"); c.drawString(668, T(88), "Lease"); c.drawString(720, T(88), "Lease")
    c.drawString(59, T(103), "Unit"); c.drawString(93, T(103), "Bath"); c.drawString(131, T(103), "Sq Ft Current Tenant"); c.drawString(468, T(103), "Rent")
    c.drawString(498, T(103), "Deposit"); c.drawString(571, T(103), "Due"); c.drawString(602, T(103), "Move-In"); c.drawString(672, T(103), "Start"); c.drawString(712, T(103), "Expires")
    c.setFont("Helvetica", 7.5)
    y = 117
    props = [
        ("12 rue Principale", [
            ("Unit 01", "2 / 1", None, "Marie Tremblay", "1,250.00", "1,250.00", "01/01/2026", "07/01/2026", "06/30/2027"),
            ("Unit 02", "1 / 1", None, "Jean Gagnon", "980.00", "-", "03/01/2025", "07/01/2026", "06/30/2027"),
            ("Unit 03", "2 / 1", None, "Paul roy & Lucie roy", "1,100.00", "(100.00)", "07/01/2024", "07/01/2026", "12/31/2026"),
            ("Unit 04", "2 / 1", None, "Vacant", None, None, None, None, None),
            ("Unit 05", "2 / 1", None, "Sofia lopez", "700.00", "2,100.00", "05/01/2023", "05/01/2026", "04/30/2027"),
        ]),
        ("40 avenue des Érables", [
            ("101", "1 / 1", "600", "AHMED FOUDA", "No Lease", "1,500.00", "08/01/2025", "No Lease", "No Lease"),
            ("102", "2 / 1", "700", "LINDA UPSHAW", "1,450.00", "-", "02/01/2025", "02/01/2026", "01/31/2027"),
        ]),
    ]
    for name, units in props:
        c.setFont("Helvetica-Bold", 8); c.drawString(48, T(y), name); c.setFont("Helvetica", 7.5); y += 13
        for unit, bb, sq, tenant, rent, bal, mi, st, ex in units:
            c.drawString(58, T(y), unit); c.drawString(92, T(y), bb)
            if sq: c.drawString(136, T(y), sq)
            c.drawString(158, T(y), tenant)
            if rent == "No Lease": c.drawString(451, T(y), "No Lease")
            elif rent: c.drawRightString(484, T(y), rent)
            if bal: c.drawRightString(590, T(y), bal)
            if mi:
                c.drawString(595, T(y), mi)
                if st == "No Lease": c.drawString(658, T(y), "No Lease"); c.drawString(711, T(y), "No Lease")
                else: c.drawString(641, T(y), st); c.drawString(687, T(y), ex)
            y += 13
        y += 13
    c.setFont("Helvetica-Bold", 8)
    c.drawString(48, T(y + 10), "TOTAL"); c.drawString(158, T(y + 10), "Occupancy: 86%"); c.drawRightString(484, T(y + 10), "5,480.00"); c.drawString(518, T(y + 10), "-"); c.drawRightString(590, T(y + 10), "4,750.00")
    c.setFont("Helvetica", 7); c.drawString(48, T(y + 50), "Report Created: October 31, 2026 9:00 AM"); c.drawString(48, T(y + 62), "Powered by Stessa")
    c.save()

def amex_summary():
    """Amex-style statement with the account summary Amex prints around the transactions: credit limit,
    available credit, cash advance limit, minimum payment, due date, interest rates, rewards points.
    None of these are transactions."""
    c = canvas.Canvas(str(OUT / "amex-with-summary.pdf"), pagesize=letter)
    c.setFont("Helvetica-Bold", 14); c.drawString(50, H - 50, "American Express Business Edge Card")
    c.setFont("Helvetica", 9)
    c.drawString(50, H - 66, "Account Ending 2006")
    c.drawString(50, H - 78, "Statement Period Oct 1, 2026 to Oct 31, 2026")
    c.drawString(330, H - 66, "Payment Due Date Nov 21, 2026"); c.drawRightString(560, H - 78, "Minimum Payment $25.00")
    c.drawString(50, H - 96, "Previous Balance"); c.drawRightString(250, H - 96, "$1,250.00")
    c.drawString(50, H - 108, "Payments and Credits"); c.drawRightString(250, H - 108, "-$1,250.00")
    c.drawString(50, H - 120, "New Charges"); c.drawRightString(250, H - 120, "$978.41")
    c.drawString(50, H - 132, "New Balance"); c.drawRightString(250, H - 132, "$978.41")
    c.drawString(330, H - 96, "Credit Limit"); c.drawRightString(560, H - 96, "$15,000.00")
    c.drawString(330, H - 108, "Available Credit"); c.drawRightString(560, H - 108, "$14,021.59")
    c.drawString(330, H - 120, "Cash Advance Limit"); c.drawRightString(560, H - 120, "$3,000.00")
    y = H - 160
    c.setFont("Helvetica-Bold", 9)
    c.drawString(50, y, "Transaction Date"); c.drawString(130, y, "Posting Date"); c.drawString(200, y, "Details"); c.drawRightString(560, y, "Amount ($)")
    c.setFont("Helvetica", 9)
    rows = [("Oct 3", "Oct 4", "PAYMENT RECEIVED - THANK YOU", "-1,250.00"), ("Oct 7", "Oct 8", "HOME DEPOT #7051 MONTREAL", "412.66"),
            ("Oct 14", "Oct 15", "BELL CANADA", "95.40"), ("Oct 22", "Oct 23", "RONA #61089 LAVAL", "470.35")]
    for d, p_, desc, amt in rows:
        y -= 15
        c.drawString(50, y, d); c.drawString(130, y, p_); c.drawString(200, y, desc); c.drawRightString(560, y, amt)
    # Right under the transactions, as on real statements:
    y -= 15; c.drawString(200, y, "Total of New Charges"); c.drawRightString(560, y, "978.41")
    y -= 13; c.drawString(200, y, "Credit Limit"); c.drawRightString(560, y, "15,000.00")
    y -= 13; c.drawString(200, y, "Available Credit"); c.drawRightString(560, y, "14,021.59")
    y -= 13; c.drawString(200, y, "Minimum Payment Due"); c.drawRightString(560, y, "25.00")
    y -= 26
    c.drawString(50, y, "Oct 31, 2026"); c.drawString(200, y, "Credit limit as of statement date"); c.drawRightString(560, y, "15,000.00")
    y -= 13; c.drawString(50, y, "Nov 21, 2026"); c.drawString(200, y, "Payment due date - minimum payment"); c.drawRightString(560, y, "25.00")
    y -= 26
    c.drawString(50, y, "Interest Rates"); y -= 13
    c.drawString(60, y, "Purchases 21.99%    Cash advances 21.99%"); y -= 13
    c.drawString(50, y, "Membership Rewards points earned this period: 978")
    c.save()

if __name__ == "__main__":
    chequing(); card(); amex(); desjardins_fr(); desjardins_multi(); scanned(); scotia_all(); scotia_visa(); unusual(); scotia_personal(); scotia_fr_placements(); stessa_rent_roll(); amex_summary()
    print("generated", sorted(p.name for p in OUT.glob("*.pdf")))
