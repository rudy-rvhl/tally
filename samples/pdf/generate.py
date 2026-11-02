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

if __name__ == "__main__":
    chequing(); card(); amex(); desjardins_fr(); desjardins_multi(); scanned()
    print("generated", sorted(p.name for p in OUT.glob("*.pdf")))
