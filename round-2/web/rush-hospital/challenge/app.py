"""Rush Hospital Portal - intentionally vulnerable web app for HZU18 CTF.

Vulnerabilities by design:

1. IDOR red herring on /report/<patient_id>/<result_id>: the route trusts the
   patient_id in the URL and never checks it against session.user_id, so any
   logged-in user can download any other user's PDF lab report. The exposed
   data is realistic-looking medical filler and contains no flag.
2. Real bug: blind SQL injection in /api/labcheck. The handler concatenates
   the test_code query parameter into a SELECT without parameterization. The
   handler returns a PDF whose footer says "Match Found: TRUE" or "FALSE"
   based on whether the resulting query produced any rows. That is the
   boolean oracle the player extracts the flag through.

The flag lives in a separate single-row table flag_storage(flag TEXT). The
table name is intentionally exposed in /api/docs to spare U18 students the
fully-blind sqlite_master enumeration step.
"""

from __future__ import annotations

import os
import secrets
import sqlite3
from functools import wraps
from io import BytesIO

from flask import (
    Flask,
    flash,
    g,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from fpdf import FPDF
from werkzeug.security import check_password_hash, generate_password_hash


DB_PATH = os.environ.get("DB_PATH", "/tmp/hospital.db")
FLAG = os.environ.get("FLAG", "HZU18{dev_flag_change_me_at_deploy_time}")


def get_db() -> sqlite3.Connection:
    db = getattr(g, "_db", None)
    if db is None:
        db = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
        g._db = db
    return db


LAB_DEV_USERNAME = "admin"
LAB_DEV_TOKEN = os.environ.get("LAB_DEV_TOKEN", "kh-lab-internal-2026-7c4f")


def init_db() -> None:
    """Create tables and seed deterministic demo data on first boot."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT,
            registry_no TEXT,
            dev_token TEXT
        );
        CREATE TABLE IF NOT EXISTS lab_tests (
            id INTEGER PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            unit TEXT
        );
        CREATE TABLE IF NOT EXISTS patient_lab_results (
            id INTEGER PRIMARY KEY,
            patient_id INTEGER NOT NULL,
            test_code TEXT NOT NULL,
            value REAL,
            taken_at TEXT
        );
        CREATE TABLE IF NOT EXISTS flag_storage (
            id INTEGER PRIMARY KEY,
            flag TEXT NOT NULL
        );
        """
    )

    tests = [
        ("GLU", "Glucose", "mg/dL"),
        ("HGB", "Hemoglobin", "g/dL"),
        ("CHL", "Cholesterol", "mg/dL"),
        ("TSH", "Thyroid Stimulating Hormone", "mIU/L"),
        ("CRE", "Creatinine", "mg/dL"),
        ("WBC", "White Blood Cell Count", "10^3/uL"),
    ]
    conn.executemany(
        "INSERT OR IGNORE INTO lab_tests(code, name, unit) VALUES(?,?,?)", tests
    )

    if not conn.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        seed_users = [
            ("bat.erdene", "Bat-Erdene Sodnom", "M-2026-0001", None),
            ("naran.suuri", "Naran Suuri", "M-2026-0002", None),
            ("munkhbat.altan", "Munkhbat Altan", "M-2026-0003", None),
            ("oyunaa.purev", "Oyunaa Purev", "M-2026-0004", None),
            (LAB_DEV_USERNAME, "System Administrator", "M-ADM-0000", LAB_DEV_TOKEN),
        ]
        for u, name, regno, token in seed_users:
            conn.execute(
                "INSERT INTO users(username, password_hash, full_name, registry_no, dev_token) "
                "VALUES(?,?,?,?,?)",
                (u, generate_password_hash("hospital2026"), name, regno, token),
            )

        seed_results = [
            (1, "GLU", 95.2, "2026-04-20"),
            (1, "HGB", 14.5, "2026-04-20"),
            (1, "CHL", 188.0, "2026-04-22"),
            (2, "CHL", 220.0, "2026-04-21"),
            (2, "TSH", 2.1, "2026-04-22"),
            (3, "TSH", 1.8, "2026-04-22"),
            (3, "WBC", 6.4, "2026-04-23"),
            (4, "CRE", 0.9, "2026-04-23"),
            (4, "GLU", 102.0, "2026-04-24"),
        ]
        conn.executemany(
            "INSERT INTO patient_lab_results(patient_id, test_code, value, taken_at) VALUES(?,?,?,?)",
            seed_results,
        )

    # keep lab.dev token in sync with env var across restarts
    conn.execute(
        "UPDATE users SET dev_token = ? WHERE username = ?",
        (LAB_DEV_TOKEN, LAB_DEV_USERNAME),
    )

    conn.execute("DELETE FROM flag_storage")
    conn.execute("INSERT INTO flag_storage(flag) VALUES(?)", (FLAG,))
    conn.commit()
    conn.close()


def create_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = secrets.token_hex(32)
    init_db()

    @app.teardown_appcontext
    def close_db(_exc):  # noqa: ANN001
        db = getattr(g, "_db", None)
        if db is not None:
            db.close()

    def login_required(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if "user_id" not in session:
                return redirect(url_for("login"))
            return view(*args, **kwargs)

        return wrapper

    @app.get("/")
    def index():
        if "user_id" in session:
            return redirect(url_for("profile", view=session["username"]))
        return render_template("index.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = (request.form.get("username") or "").strip()
            password = request.form.get("password") or ""
            full_name = (request.form.get("full_name") or "").strip()
            if not username or not password:
                flash("username and password are required", "error")
                return redirect(url_for("register"))
            db = get_db()
            try:
                cur = db.execute(
                    "INSERT INTO users(username, password_hash, full_name, registry_no) VALUES(?,?,?,?)",
                    (
                        username,
                        generate_password_hash(password),
                        full_name,
                        f"M-2026-{secrets.token_hex(3).upper()}",
                    ),
                )
                db.commit()
                session["user_id"] = cur.lastrowid
                session["username"] = username
                return redirect(url_for("dashboard"))
            except sqlite3.IntegrityError:
                flash("username already taken", "error")
                return redirect(url_for("register"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = request.form.get("username") or ""
            password = request.form.get("password") or ""
            row = get_db().execute(
                "SELECT * FROM users WHERE username = ?", (username,)
            ).fetchone()
            if row and check_password_hash(row["password_hash"], password):
                session["user_id"] = row["id"]
                session["username"] = row["username"]
                return redirect(url_for("dashboard"))
            flash("invalid credentials", "error")
        return render_template("login.html")

    @app.get("/logout")
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.get("/dashboard")
    @login_required
    def dashboard():
        return redirect(url_for("profile", view=session["username"]))

    @app.get("/report/<int:patient_id>/<int:result_id>")
    @login_required
    def report(patient_id: int, result_id: int):
        db = get_db()
        row = db.execute(
            """
            SELECT r.id, r.patient_id, r.test_code, r.value, r.taken_at,
                   t.name AS test_name, t.unit AS unit
            FROM patient_lab_results r
            LEFT JOIN lab_tests t ON r.test_code = t.code
            WHERE r.patient_id = ? AND r.id = ?
            """,
            (patient_id, result_id),
        ).fetchone()
        user = db.execute("SELECT * FROM users WHERE id = ?", (patient_id,)).fetchone()
        if not row or not user:
            return "report not found", 404
        pdf_bytes = build_result_pdf(user, row)
        return send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"report-{result_id}.pdf",
        )

    @app.get("/api/labcheck")
    @login_required
    def labcheck():
        test_code = request.args.get("test_code")
        if test_code is None or test_code == "":
            flash("test_code is required", "error")
            return redirect(url_for("dashboard"))

        token = request.headers.get("X-Lab-Token", "")
        row = get_db().execute(
            "SELECT dev_token FROM users WHERE username = ?",
            (LAB_DEV_USERNAME,),
        ).fetchone()
        valid_token = (row["dev_token"] if row else None) or ""
        authorised = bool(valid_token) and token == valid_token

        if authorised:
            sql = (
                "SELECT COUNT(*) FROM patient_lab_results "
                f"WHERE test_code = '{test_code}'"
            )
            try:
                count = get_db().execute(sql).fetchone()[0]
            except sqlite3.Error:
                count = 0
            found = count > 0
        else:
            # Without the lab.dev token the receipt is a stub: every code is
            # reported as a match. The endpoint never confirms a non-match
            # without proper internal authorisation.
            found = True

        pdf_bytes = build_labcheck_pdf(test_code, found, authorised=authorised)
        response = send_file(
            BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name="labcheck.pdf",
        )
        response.headers["Vary"] = "X-Lab-Token"
        response.headers["Cache-Control"] = "private, no-store"
        return response

    @app.route("/profile", methods=["GET", "POST"])
    @login_required
    def profile():
        db = get_db()
        if request.method == "POST":
            full_name = (request.form.get("full_name") or "").strip()
            db.execute(
                "UPDATE users SET full_name = ? WHERE id = ?",
                (full_name, session["user_id"]),
            )
            db.commit()
            flash("profile updated", "success")
            return redirect(url_for("profile"))

        view_username = request.args.get("view")
        viewed_other = False
        if view_username:
            user = db.execute(
                "SELECT * FROM users WHERE username = ?", (view_username,)
            ).fetchone()
            if not user:
                flash("user not found", "error")
                return redirect(url_for("profile"))
            viewed_other = user["id"] != session["user_id"]
        else:
            user = db.execute(
                "SELECT * FROM users WHERE id = ?", (session["user_id"],)
            ).fetchone()
        result_count = db.execute(
            "SELECT COUNT(*) FROM patient_lab_results WHERE patient_id = ?",
            (user["id"],),
        ).fetchone()[0]
        results = []
        if not viewed_other:
            results = db.execute(
                """
                SELECT r.id, r.patient_id, r.test_code, r.value, r.taken_at,
                       t.name AS test_name, t.unit AS unit
                FROM patient_lab_results r
                LEFT JOIN lab_tests t ON r.test_code = t.code
                WHERE r.patient_id = ?
                ORDER BY r.taken_at DESC
                """,
                (user["id"],),
            ).fetchall()
        return render_template(
            "profile.html",
            user=user,
            result_count=result_count,
            viewed_other=viewed_other,
            results=results,
        )

    @app.get("/about")
    def about():
        return render_template("about.html")

    @app.get("/healthz")
    def healthz():
        return "ok", 200

    return app


def safe_ascii(s, limit: int = 80) -> str:
    if s is None:
        return ""
    text = str(s)[:limit]
    return "".join(c if 32 <= ord(c) < 127 else "?" for c in text)


REFERENCE_RANGES = {
    "GLU": {"low": 70.0, "high": 110.0, "method": "Hexokinase enzymatic", "specimen": "Serum, fasting"},
    "HGB": {"low": 13.5, "high": 17.5, "method": "Cyanmethemoglobin photometric", "specimen": "Whole blood (EDTA)"},
    "CHL": {"low": 125.0, "high": 200.0, "method": "Cholesterol oxidase enzymatic", "specimen": "Serum, fasting"},
    "TSH": {"low": 0.4, "high": 4.5, "method": "Chemiluminescent immunoassay", "specimen": "Serum"},
    "CRE": {"low": 0.7, "high": 1.3, "method": "Jaffe kinetic alkaline picrate", "specimen": "Serum"},
    "WBC": {"low": 4.0, "high": 11.0, "method": "Flow cytometry impedance", "specimen": "Whole blood (EDTA)"},
}

ORDERING_PHYSICIANS = ["Dr. B. Tsogtbaatar", "Dr. N. Erdenebileg", "Dr. S. Oyuntuya", "Dr. M. Batjargal"]
LAB_TECHNICIANS = ["G. Tuul", "B. Saruul", "U. Khulan", "T. Munkh"]


def classify_value(value: float, low: float, high: float) -> tuple[str, str]:
    if value < low * 0.5 or value > high * 1.5:
        return "CRITICAL", "Notify ordering physician immediately"
    if value < low:
        return "LOW", "Below reference range"
    if value > high:
        return "HIGH", "Above reference range"
    return "NORMAL", "Within reference range"


def build_result_pdf(user, row) -> bytes:
    code = (row["test_code"] or "").upper()
    ref = REFERENCE_RANGES.get(code, {"low": 0.0, "high": 0.0, "method": "Standard assay", "specimen": "Serum"})
    try:
        value_num = float(row["value"]) if row["value"] is not None else 0.0
    except (TypeError, ValueError):
        value_num = 0.0
    status, status_note = classify_value(value_num, ref["low"], ref["high"])
    physician = ORDERING_PHYSICIANS[(row["id"] - 1) % len(ORDERING_PHYSICIANS)]
    technician = LAB_TECHNICIANS[(row["id"] + 1) % len(LAB_TECHNICIANS)]
    accession = f"KH-{2026000000 + row['id']:010d}"

    pdf = FPDF()
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(0, 8, "RUSH HOSPITAL", ln=True, align="C")
    pdf.set_font("Helvetica", size=9)
    pdf.cell(0, 5, "Rush Hospital | 14 Sukhbaatar Square, Ulaanbaatar 14200, Mongolia", ln=True, align="C")
    pdf.cell(0, 5, "Phone +976-11-555-0100 | Lab Department | License MED-2018-447", ln=True, align="C")
    pdf.set_draw_color(13, 74, 107)
    pdf.set_line_width(0.6)
    pdf.line(15, pdf.get_y() + 2, 195, pdf.get_y() + 2)
    pdf.ln(8)

    pdf.set_font("Helvetica", "B", 13)
    pdf.cell(0, 8, "LABORATORY REPORT", ln=True, align="C")
    pdf.set_font("Helvetica", size=9)
    pdf.cell(0, 5, f"Accession No: {accession}", ln=True, align="C")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(232, 240, 248)
    pdf.cell(0, 7, "  PATIENT INFORMATION", ln=True, fill=True)
    pdf.set_font("Helvetica", size=10)
    pdf.ln(1)
    _two_col(pdf, "Patient Name:", safe_ascii(user["full_name"]) or safe_ascii(user["username"]),
             "Registry No:", safe_ascii(user["registry_no"]))
    _two_col(pdf, "Username:", safe_ascii(user["username"]),
             "Date of Birth:", "1985-06-12 (estimated)")
    _two_col(pdf, "Sex:", "Not recorded",
             "Patient ID:", str(user["id"]))
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  SPECIMEN", ln=True, fill=True)
    pdf.set_font("Helvetica", size=10)
    pdf.ln(1)
    _two_col(pdf, "Specimen Type:", safe_ascii(ref["specimen"]),
             "Collection Date:", safe_ascii(row["taken_at"]))
    _two_col(pdf, "Collected By:", safe_ascii(technician),
             "Received At:", f"{safe_ascii(row['taken_at'])} 09:14")
    _two_col(pdf, "Ordering Physician:", safe_ascii(physician),
             "Reported At:", f"{safe_ascii(row['taken_at'])} 14:32")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  TEST RESULTS", ln=True, fill=True)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(245, 245, 245)
    pdf.cell(60, 7, " Test", border=1, fill=True)
    pdf.cell(35, 7, " Result", border=1, fill=True, align="C")
    pdf.cell(35, 7, " Reference Range", border=1, fill=True, align="C")
    pdf.cell(20, 7, " Unit", border=1, fill=True, align="C")
    pdf.cell(30, 7, " Status", border=1, fill=True, align="C")
    pdf.ln(7)
    pdf.set_font("Helvetica", size=9)
    pdf.cell(60, 7, f" {safe_ascii(row['test_name'])} ({safe_ascii(row['test_code'])})", border=1)
    pdf.cell(35, 7, f"{row['value']}", border=1, align="C")
    pdf.cell(35, 7, f"{ref['low']:.1f} - {ref['high']:.1f}", border=1, align="C")
    pdf.cell(20, 7, safe_ascii(row["unit"]), border=1, align="C")
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(30, 7, status, border=1, align="C")
    pdf.ln(7)

    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(80, 80, 80)
    pdf.ln(2)
    pdf.multi_cell(0, 5, f"Note: {status_note}.  Method: {safe_ascii(ref['method'])}.")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  CLINICAL INTERPRETATION", ln=True, fill=True)
    pdf.set_font("Helvetica", size=9)
    pdf.ln(1)
    pdf.multi_cell(0, 5,
        "Results above are valid for the specimen type and collection time noted. "
        "Reference ranges may vary by population and laboratory. This report is "
        "intended for use by the ordering physician and should be interpreted in "
        "the context of the patient's clinical history. For abnormal results, "
        "please consult Rush Hospital Outpatient Lab at extension 4412.",
    )
    pdf.ln(6)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "  AUTHORIZATION", ln=True, fill=True)
    pdf.set_font("Helvetica", size=9)
    pdf.ln(1)
    _two_col(pdf, "Verified By:", safe_ascii(physician),
             "Lab Director:", "Dr. P. Bayarmaa")
    _two_col(pdf, "Lab Tech:", safe_ascii(technician),
             "Report Issued:", f"{safe_ascii(row['taken_at'])} 14:35")
    pdf.ln(8)

    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 4, "End of report", ln=True, align="C")
    pdf.cell(0, 4,
             "This document is generated electronically and is valid without a wet signature.",
             ln=True, align="C")
    pdf.cell(0, 4,
             "Rush Hospital Patient Portal v0.4-dev  |  Confidential medical record",
             ln=True, align="C")
    return bytes(pdf.output())


def _two_col(pdf, label_a, value_a, label_b, value_b):
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(35, 5, label_a)
    pdf.set_font("Helvetica", size=9)
    pdf.cell(60, 5, str(value_a))
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(35, 5, label_b)
    pdf.set_font("Helvetica", size=9)
    pdf.cell(60, 5, str(value_b), ln=True)


def build_labcheck_pdf(test_code: str, found: bool, authorised: bool = True) -> bytes:
    import datetime as _dt

    safe_code = safe_ascii(test_code, limit=160)
    short_code = safe_code[:32]
    code_upper = (safe_code or "").strip("'\"; ").upper()[:8]
    test_meta = REFERENCE_RANGES.get(code_upper)
    test_name_lookup = {
        "GLU": "Glucose", "HGB": "Hemoglobin", "CHL": "Cholesterol",
        "TSH": "Thyroid Stimulating Hormone", "CRE": "Creatinine",
        "WBC": "White Blood Cell Count",
    }
    related_panels = {
        "GLU": ["Diabetes Panel", "Metabolic Panel (BMP)", "HbA1c follow-up"],
        "HGB": ["Complete Blood Count (CBC)", "Iron Panel", "Reticulocyte Count"],
        "CHL": ["Lipid Panel", "Cardiovascular Risk Profile", "ApoB Reflex"],
        "TSH": ["Thyroid Panel (Free T3, Free T4)", "Anti-TPO Reflex"],
        "CRE": ["Renal Function Panel", "eGFR (calculated)", "BUN Reflex"],
        "WBC": ["Complete Blood Count (CBC)", "Differential Reflex", "Sepsis Workup"],
    }
    test_display = test_name_lookup.get(code_upper, "(unrecognized code)")
    panels = related_panels.get(code_upper, [])
    now = _dt.datetime.utcnow()
    ticket_id = f"LL-{now.strftime('%Y%m%d')}-{abs(hash(safe_code)) % 100000:05d}"
    batch_id = f"BATCH-{now.strftime('%Y%m')}-{(abs(hash(safe_code)) // 1000) % 9999:04d}"
    seq = abs(hash(safe_code))
    queue_position = (seq % 18) + 1
    queue_total = queue_position + (seq % 6) + 2
    sample_avg_min = round(2.5 + (seq % 17) / 5.0, 1)

    pdf = FPDF()
    pdf.compress = False
    pdf.set_auto_page_break(auto=False)
    pdf.add_page()

    # Header (compressed)
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 7, "RUSH HOSPITAL", ln=True, align="C")
    pdf.set_font("Helvetica", size=8)
    pdf.cell(0, 4, "14 Sukhbaatar Square, Ulaanbaatar 14200 | +976-11-555-0100 | License MED-2018-447", ln=True, align="C")
    pdf.cell(0, 4, "ISO 15189:2022 | NGS-MN-019 | CAP enrolled", ln=True, align="C")
    pdf.set_draw_color(13, 74, 107)
    pdf.set_line_width(0.5)
    pdf.line(15, pdf.get_y() + 1, 195, pdf.get_y() + 1)
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, "LABORATORY ORDER LOOKUP RECEIPT", ln=True, align="C")
    pdf.set_font("Helvetica", size=8)
    pdf.cell(0, 4, f"Ticket {ticket_id}  |  Batch {batch_id}  |  {now.strftime('%Y-%m-%d %H:%M:%S')} UTC  |  Class: PRESENCE-LOOKUP", ln=True, align="C")
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(232, 240, 248)
    pdf.cell(0, 5, "  REQUEST DETAILS", ln=True, fill=True)
    pdf.ln(0)
    _row3(pdf, "Operator", "Portal API",
          "Source Table", "patient_lab_results",
          "Backend", "SQLite 3.45.1")
    _row3(pdf, "Query Type", "presence check",
          "Query Field", "test_code",
          "Index", "idx_test_code")
    _row3(pdf, "Submitted", short_code or "(empty)",
          "Code Length", str(len(safe_code)),
          "Encoding", "ASCII")
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "  TEST METADATA", ln=True, fill=True)
    if test_meta:
        _row3(pdf, "Recognized", code_upper,
              "Display Name", test_display,
              "LOINC", "auto-resolved")
        _row3(pdf, "Specimen", safe_ascii(test_meta["specimen"]),
              "Method", safe_ascii(test_meta["method"]),
              "Billing", f"KH-LAB-{code_upper}")
        _row3(pdf, "Ref Range", f"{test_meta['low']:.1f} - {test_meta['high']:.1f}",
              "Critical Low", f"{test_meta['low'] * 0.5:.1f}",
              "Critical High", f"{test_meta['high'] * 1.5:.1f}")
    else:
        _row3(pdf, "Recognized", "no",
              "Display Name", "(unknown)",
              "LOINC", "(none)")
        _row3(pdf, "Specimen", "n/a",
              "Method", "n/a",
              "Billing", "n/a")
        _row3(pdf, "Ref Range", "n/a",
              "Critical Low", "n/a",
              "Critical High", "n/a")
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "  RELATED PANELS / REFLEXES", ln=True, fill=True)
    pdf.set_font("Helvetica", size=8)
    if panels:
        pdf.cell(0, 4, "  " + ", ".join(safe_ascii(p) for p in panels), ln=True)
    else:
        pdf.cell(0, 4, "  No related panels are mapped to this code.", ln=True)
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "  PROCESSING QUEUE", ln=True, fill=True)
    _row3(pdf, "Queue Position", f"{queue_position} of {queue_total}",
          "Avg Process", f"{sample_avg_min:.1f} min",
          "Throughput", f"{1820 + (seq % 230)}/day")
    _row3(pdf, "Routing", "Bench A2 (Chem)",
          "Backup Bench", "Bench B1 (Hema)",
          "Cold Chain", "2-8 C ok")
    _row3(pdf, "Pre-analytical", "ok",
          "Last Calibration", now.strftime("%Y-%m-%d 06:30"),
          "Connection Pool", "ro-replica-3")
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "  CHAIN OF CUSTODY (LAST 5)", ln=True, fill=True)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(245, 245, 245)
    pdf.cell(28, 5, " Time", border=1, fill=True)
    pdf.cell(54, 5, " Event", border=1, fill=True)
    pdf.cell(48, 5, " Actor", border=1, fill=True)
    pdf.cell(50, 5, " Location", border=1, fill=True)
    pdf.ln(5)
    pdf.set_font("Helvetica", size=8)
    chain = [
        (now.strftime('%H:%M:%S'), "lookup.received", "portal-api", "edge-router"),
        ((now - _dt.timedelta(seconds=2)).strftime('%H:%M:%S'), "auth.session_check", "session-svc", "auth-pod-2"),
        ((now - _dt.timedelta(seconds=3)).strftime('%H:%M:%S'), "rate.budget_ok", "rate-limiter", "edge-router"),
        ((now - _dt.timedelta(seconds=4)).strftime('%H:%M:%S'), "db.query_dispatched", "query-svc", "ro-replica-3"),
        ((now - _dt.timedelta(seconds=5)).strftime('%H:%M:%S'), "audit.log_entry", "audit-svc", "compliance-3"),
    ]
    for t, ev, actor, loc in chain:
        pdf.cell(28, 4, f" {t}", border=1)
        pdf.cell(54, 4, f" {ev}", border=1)
        pdf.cell(48, 4, f" {actor}", border=1)
        pdf.cell(50, 4, f" {loc}", border=1)
        pdf.ln(4)
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "  AUDIT TRAIL", ln=True, fill=True)
    _row3(pdf, "Verified By", "system (automated)",
          "Lab Director", "Dr. P. Bayarmaa",
          "Compliance", "MED-2018-447")
    _row3(pdf, "Backup Copy", "audit-vault-mn",
          "Hash Alg", "SHA-256",
          "Retention", "90 days")
    _row3(pdf, "Checksum", f"{abs(hash(safe_code)):016x}"[:16],
          "Issuer Cert", "kh-lab-root-2024",
          "Sensitivity", "Internal")
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 5, "  USAGE NOTICE", ln=True, fill=True)
    pdf.set_font("Helvetica", size=8)
    pdf.multi_cell(0, 4,
        "This receipt confirms only whether a test code is present in the lab results database. "
        "It does not disclose patient identity, measured value, or any other Protected Health "
        "Information. Misuse is monitored under MED-2018-447 section 14(c).",
    )

    # Small subtle verdict footer in bottom-right corner
    verdict = "TRUE" if found else "FALSE"
    note = (
        "At least one row in patient_lab_results matched the submitted query."
        if found else
        "No rows in patient_lab_results matched the submitted query."
    )

    pdf.set_y(-22)
    pdf.set_draw_color(180, 180, 180)
    pdf.set_line_width(0.2)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(2)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(130, 4, "End of receipt. Rush Hospital Patient Portal v0.4-dev | Confidential lookup record")
    pdf.set_font("Helvetica", size=7)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(50, 4, f"Match Found: {verdict}", align="R")
    pdf.ln(4)
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(130, 4, "Generated electronically. No wet signature required.")
    pdf.set_font("Helvetica", "I", 7)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(50, 4, note, align="R")
    pdf.set_text_color(0, 0, 0)
    return bytes(pdf.output())


def _row3(pdf, la, va, lb, vb, lc, vc):
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(22, 4, la)
    pdf.set_font("Helvetica", size=8)
    pdf.cell(38, 4, str(va))
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(22, 4, lb)
    pdf.set_font("Helvetica", size=8)
    pdf.cell(38, 4, str(vb))
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(22, 4, lc)
    pdf.set_font("Helvetica", size=8)
    pdf.cell(38, 4, str(vc), ln=True)


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000)
