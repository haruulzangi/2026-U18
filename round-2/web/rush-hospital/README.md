# Rush Hospital

Web challenge for HZU18 2026 round 2.

## Theme

A patient portal for "Rush Hospital." Players can register, log in, see their
lab results, download PDF reports, edit their profile, and run a "lab lookup"
tool that returns a PDF stating whether any patient has a result for a given
test code.

There is no API documentation page. Players have to find the vulnerable
endpoint by exercising the site naturally and watching their proxy history.

## Vulnerabilities

| Bug | Where | Real or red herring | Notes |
|-----|-------|--------------------|-------|
| IDOR | `GET /report/<patient_id>/<result_id>` | Red herring | Trusts the `patient_id` from the URL with no session check. Lets players download other patients' PDFs. Those PDFs contain seeded medical filler. No flag. |
| Blind SQLi | `GET /api/labcheck?test_code=...` | **Real** | Concatenates `test_code` into a `SELECT COUNT(*)`. The handler returns a PDF whose footer reads `Match Found: TRUE` if the query produced any rows, `FALSE` otherwise. Boolean oracle for full blind extraction. |

The flag lives in a separate `flag_storage(flag TEXT)` table. The table name
is **not** disclosed to the player. They have to enumerate `sqlite_master`
through the same boolean oracle to discover it.

## Intended solve at a glance

1. Register and log in.
2. Click around. The dashboard exposes a "lab lookup" form. Submitting it
   issues `GET /api/labcheck?test_code=GLU` and downloads a PDF whose footer
   reads `Match Found: TRUE`.
3. From Burp / browser devtools, notice the only user-controlled query param
   is `test_code`. Try `GLU' AND '1'='1` -> TRUE, `GLU' AND '1'='2` -> FALSE.
   Injection confirmed.
4. The PDF text is uncompressed in the bytes (verified). `Match Found: TRUE`
   and `Match Found: FALSE` are grep-able from the response.
5. Enumerate user tables via `sqlite_master`:
   `?test_code=ZZZ' OR (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%') >= 4--`
6. For each table, extract its name char by char with binary-searched SUBSTR.
7. For each candidate table, test if any column starts with `HZU18{`:
   `?test_code=ZZZ' OR (SELECT SUBSTR(<col>,1,6) FROM <tbl> LIMIT 1) = 'HZU18{'--`
8. Once `flag_storage.flag` is identified, binary-search SUBSTR per position
   to extract the flag.

A reference solver implements the full blind path. Verified end to end.

## Local run

```bash
docker compose up --build
# open http://localhost:3011
```

Override the flag at deploy time via the `FLAG` env var.

## Surface for the review agent

- DB lives in `/tmp/hospital.db`, in-container tmpfs. Wiped on restart.
- `init_db` re-seeds `flag_storage` from the env var on every boot. Demo users
  and seed lab results are only inserted on first boot.
- Demo accounts: `bat.erdene`, `naran.suuri`, `munkhbat.altan`, `oyunaa.purev`
  (password `hospital2026`). Players can also self-register.
- Auth on `/api/labcheck` is `login_required` only. No rate limit.
- `init_db` flag re-seed has no transaction guard against concurrent workers.
  `workers=1` in the Dockerfile keeps it deterministic.
- The vulnerable SQL is in `app.py` `labcheck()`:
  ```python
  sql = (
      "SELECT COUNT(*) FROM patient_lab_results "
      f"WHERE test_code = '{test_code}'"
  )
  ```
- PDF compression is disabled only on the labcheck PDF so the boolean is
  grep-able from raw bytes. Other PDFs (lab reports) keep compression for
  realism.
