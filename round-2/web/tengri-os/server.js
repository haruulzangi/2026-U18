const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const app = express();

// Security headers
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.removeHeader("X-Powered-By");
  // Prevent source from being cached/saved easily
  if (req.path.endsWith(".js") || req.path.endsWith(".css")) {
    res.set("Cache-Control", "no-store, no-cache");
  }
  next();
});

// Block access to source files
app.get("/desktop.js", (req, res) => res.status(404).send("Not found"));
app.get("/build.js", (req, res) => res.status(404).send("Not found"));
app.get("/server.js", (req, res) => res.status(404).send("Not found"));
app.get("/bot.js", (req, res) => res.status(404).send("Not found"));
app.get("/package.json", (req, res) => res.status(404).send("Not found"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const FLAG1 = "HZU18{t3ngr1_m0r1n_sql1_d4vkh4r}";
const FLAG3 = "HZU18{cmd_1nj3ct_kh4n_t3ngr1_0rd0n}";
const flag3Path = path.join(__dirname, "flag3.txt");
if (!fs.existsSync(flag3Path)) fs.writeFileSync(flag3Path, FLAG3);

/* ═══════════════════════════════════════════════════
   Per-user sessions
   ═══════════════════════════════════════════════════ */
const sessions = {};

function getSession(sid) {
  if (!sid || typeof sid !== "string") return null;
  return sessions[sid] || null;
}

// Middleware: auto-create session for challenge routes if sid is invalid
app.use("/challenge", (req, res, next) => {
  const sid = req.query.sid;
  if (!sid || !sessions[sid]) {
    const s = createSession();
    const sep = req.originalUrl.includes("?") ? "&" : "?";
    const clean = req.originalUrl
      .replace(/([?&])sid=[^&]*/g, "")
      .replace(/\?&/, "?")
      .replace(/\?$/, "");
    return res.redirect(
      clean + (clean.includes("?") ? "&" : "?") + "sid=" + s.id,
    );
  }
  next();
});

function createSession() {
  const sid = crypto.randomBytes(8).toString("hex");
  const db = new Database(":memory:");
  const adminPass = crypto.randomBytes(32).toString("hex");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT, role TEXT);
    INSERT INTO users VALUES (1,'admin','${adminPass}','administrator');
    INSERT INTO users VALUES (2,'guest','nuuruuts123','viewer');
    CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);
  sessions[sid] = {
    id: sid,
    db,
    authed: false,
    role: null,
    webhooks: [],
    sse: [],
    cooldown: 0,
  };
  return sessions[sid];
}

app.post("/api/session", (req, res) => {
  const s = createSession();
  res.json({ sid: s.id });
});

/* ═══════════════════════════════════════════════════
   Challenge page wrapper
   ═══════════════════════════════════════════════════ */
const CSS = `*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f1923;color:#c8d6e5;font-family:'Segoe UI',system-ui,sans-serif;padding:30px}
h1{color:#00b4d8;margin-bottom:20px;font-size:1.4em}
h3{color:#48bfe3;margin-bottom:10px}
.card{background:#1a2634;border:1px solid #2a3a4a;border-radius:8px;padding:20px;margin:15px 0}
input,textarea{background:#0f1923;border:1px solid #2a3a4a;color:#c8d6e5;padding:8px 12px;border-radius:4px;width:100%;margin:5px 0;font-family:monospace;font-size:13px}
textarea{resize:vertical}
button,input[type=submit]{background:#00b4d8;color:#fff;border:none;padding:10px 20px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:13px}
button:hover,input[type=submit]:hover{background:#0096c7}
a{color:#00b4d8;text-decoration:none}a:hover{text-decoration:underline}
.err{color:#e63946;background:#1a1015;border-left:4px solid #e63946;padding:10px 15px;margin:10px 0;border-radius:0 4px 4px 0}
.ok{color:#2ec4b6;background:#0a1a18;border-left:4px solid #2ec4b6;padding:10px 15px;margin:10px 0;border-radius:0 4px 4px 0}
.flag{background:#1a1800;border:2px solid #ffd700;border-radius:8px;padding:15px;color:#ffd700;font-family:monospace;font-size:1.1em;margin:15px 0;word-break:break-all}
.info{background:#0f1a2a;border-left:4px solid #00b4d8;padding:10px 15px;margin:10px 0;border-radius:0 4px 4px 0;font-size:13px}
code{background:#0a1520;padding:2px 6px;border-radius:3px;font-family:monospace;color:#88ccaa}
table{border-collapse:collapse;width:100%}td{padding:4px 10px;border-bottom:1px solid #1a2a3a;font-size:13px}
nav{margin:15px 0;display:flex;gap:10px;flex-wrap:wrap}
nav a{background:#1a2634;padding:8px 15px;border-radius:4px;border:1px solid #2a3a4a;font-size:13px}
nav a:hover{background:#2a3a4a;text-decoration:none}
pre{background:#0a1520;padding:15px;border-radius:6px;overflow-x:auto;font-size:12px;white-space:pre-wrap;margin:10px 0;color:#88ccaa}`;

function page(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

/* ═══════════════════════════════════════════════════
   Part 1 — SQLi Login
   ═══════════════════════════════════════════════════ */
function sqlFilter(input) {
  if (/\s/.test(input)) return true;
  const l = input.toLowerCase();
  return [
    "=",
    "--",
    "#",
    "/*",
    "union",
    "select",
    "where",
    "drop",
    "delete",
    "insert",
    "update",
  ].some((b) => l.includes(b));
}

app.get("/challenge/home", (req, res) => {
  const sid = req.query.sid || "";
  res.send(
    page(
      "ХААН Network",
      `
    <h1>🏔 ХААН Network - Intelligence Portal</h1>
    <p style="color:#888;margin-bottom:20px">Authorized Access Only</p>
    <div class="card">
      <nav>
        <a href="/challenge/login?sid=${sid}">🔐 Network Login</a>
        <a href="/challenge/status?sid=${sid}">📊 System Status</a>
      </nav>
    </div>
    <div class="info">All input is inspected by the <strong>KHAAN-WALL</strong> firewall. See System Status for details.</div>
  `,
    ),
  );
});

app.get("/challenge/status", (req, res) => {
  const sid = req.query.sid || "";
  res.send(
    page(
      "System Status",
      `
    <h1>📊 System Status</h1>
    <div class="card"><h3>KHAAN-WALL Firewall v4.2 — <span style="color:#2ec4b6">ACTIVE</span></h3>
    <table>
      <tr><td>Blocked patterns:</td><td style="color:#e63946"><code>whitespace</code> <code>=</code> <code>--</code> <code>#</code> <code>/*</code> <code>union</code> <code>select</code> <code>where</code> <code>drop</code> <code>delete</code> <code>insert</code> <code>update</code></td></tr>
      <tr><td>Mode:</td><td>Substring match (case-insensitive)</td></tr>
    </table></div>
    <div class="card"><h3>Database</h3><table>
      <tr><td>Engine:</td><td>SQLite v3.39.4</td></tr>
      <tr><td>Users:</td><td>2 registered</td></tr>
    </table></div>
    <nav><a href="/challenge/home?sid=${sid}">← Back</a></nav>
  `,
    ),
  );
});

app.get("/challenge/login", (req, res) => {
  const sid = req.query.sid || "";
  const err = req.query.err || "";
  const msgs = {
    E2: "⚠️ KHAAN-WALL: Prohibited input detected!",
    E3: "❌ Invalid credentials",
    E4: "❌ System error",
  };
  res.send(
    page(
      "Login",
      `
    <h1>🔐 ХААН Network Login</h1>
    ${err ? `<div class="err">${msgs[err] || "Error"}</div>` : ""}
    <div class="card">
      <form method="POST" action="/challenge/login?sid=${sid}">
        <label>Username</label><input name="username" autocomplete="off" required>
        <br><br><label>Password</label><input name="password" type="password" autocomplete="off" required>
        <br><br><input type="submit" value="Login">
      </form>
    </div>
    <nav><a href="/challenge/status?sid=${sid}">📊 System Status (firewall info)</a></nav>
  `,
    ),
  );
});

app.post("/challenge/login", (req, res) => {
  const sid = req.query.sid || "";
  const sess = getSession(sid);
  if (!sess) return res.redirect("/challenge/login?sid=" + sid + "&err=E4");
  const { username, password } = req.body;
  if (!username || !password)
    return res.redirect("/challenge/login?sid=" + sid + "&err=E3");
  if (sqlFilter(username) || sqlFilter(password))
    return res.redirect("/challenge/login?sid=" + sid + "&err=E2");
  try {
    const q = `SELECT * FROM users WHERE username='${username}' AND password='${password}'`;
    console.log("[LOGIN]", sid.substring(0, 8), "query:", q);
    const user = sess.db.prepare(q).get();
    console.log(
      "[LOGIN]",
      sid.substring(0, 8),
      "result:",
      user ? user.username + "/" + user.role : "null",
    );
    if (user) {
      sess.authed = true;
      sess.role = user.role;
      return res.redirect("/challenge/dashboard?sid=" + sid);
    }
    return res.redirect("/challenge/login?sid=" + sid + "&err=E3");
  } catch (e) {
    return res.redirect("/challenge/login?sid=" + sid + "&err=E4");
  }
});

/* ═══════════════════════════════════════════════════
   Dashboard (after login)
   ═══════════════════════════════════════════════════ */
app.get("/challenge/dashboard", (req, res) => {
  const sid = req.query.sid || "";
  const sess = getSession(sid);
  if (!sess || !sess.authed) return res.redirect("/challenge/login?sid=" + sid);
  const isAdmin = sess.role === "administrator";
  res.send(
    page(
      "Dashboard",
      `
    <h1>🎯 ХААН Network — Dashboard</h1>
    <p style="color:#888">Welcome, ${isAdmin ? "admin" : "user"}. Role: <code>${sess.role}</code></p>
    ${isAdmin ? `<div class="flag">🏴 FLAG 1: ${FLAG1}</div>` : ""}
    <div class="card"><h3>Available Operations</h3><nav>
      <a href="/challenge/report?sid=${sid}">📨 Send Report to Head Admin</a>
      ${isAdmin ? `<a href="/challenge/ping?sid=${sid}">🔧 Network Diagnostics</a>` : ""}
      <a href="/challenge/home?sid=${sid}">🚪 Logout</a>
    </nav></div>
    <div class="info">
      <strong>📡 Intel:</strong> The Head Admin reviews all reports in their personal browser.<br>
      They carry classified secrets in their <strong>browser cookies</strong>.<br>
    </div>
    ${isAdmin ? `<div class="info"><strong>🔧 Network Diagnostics:</strong> Ping tool validates IP addresses.</div>` : ""}
  `,
    ),
  );
});

function xssSanitize(html) {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/\bon\w+\s*=/gi, "");
  s = s.replace(/javascript\s*:/gi, "");
  s = s.replace(
    /<\/?(?:iframe|object|embed|applet|base|form|meta|link|style)\b[^>]*>/gi,
    "",
  );
  return s;
}

app.get("/challenge/report", (req, res) => {
  const sid = req.query.sid || "";
  const sess = getSession(sid);
  if (!sess || !sess.authed) return res.redirect("/challenge/login?sid=" + sid);
  const msg = req.query.msg || "";
  res.send(
    page(
      "Send Report",
      `
    <h1>📨 Send Report to Head Admin</h1>
    ${msg === "ok" ? '<div class="ok">✅ Report sent! The Head Admin will review it shortly.</div>' : ""}
    ${msg === "fast" ? '<div class="err">⏳ Too fast. Wait a few seconds between reports.</div>' : ""}
    ${msg === "long" ? '<div class="err">Report too long (max 2048 chars).</div>' : ""}
    <div class="card">
      <form method="POST" action="/challenge/report?sid=${sid}">
        <label>Report Content <span style="color:#555">(HTML is allowed)</span></label>
        <textarea name="content" rows="8" placeholder="Write your report here..."></textarea>
        <br><br><input type="submit" value="Send to Head Admin">
      </form>
    </div>
    <nav><a href="/challenge/dashboard?sid=${sid}">← Dashboard</a></nav>
  `,
    ),
  );
});

app.post("/challenge/report", (req, res) => {
  const sid = req.query.sid || "";
  const sess = getSession(sid);
  if (!sess || !sess.authed) return res.redirect("/challenge/login?sid=" + sid);
  const { content } = req.body;
  if (!content || content.length > 2048)
    return res.redirect("/challenge/report?sid=" + sid + "&msg=long");
  const now = Date.now();
  if (sess.cooldown && now - sess.cooldown < 5000)
    return res.redirect("/challenge/report?sid=" + sid + "&msg=fast");
  sess.cooldown = now;

  const result = sess.db
    .prepare("INSERT INTO reports (content) VALUES (?)")
    .run(content);
  const rid = result.lastInsertRowid;

  console.log("[BOT] Triggering visit for report", Number(rid), "session", sid);
  try {
    const bot = require("./bot");
    bot
      .visitReport(sid, rid)
      .then(() => {
        console.log("[BOT] Visit completed for report", Number(rid));
      })
      .catch((e) => console.error("[BOT] Visit error:", e.message, e.stack));
  } catch (e) {
    console.error("[BOT] Module error:", e.message);
  }

  return res.redirect("/challenge/report?sid=" + sid + "&msg=ok");
});

app.get("/challenge/admin/report/:id", (req, res) => {
  const sid = req.query.sid || "";
  const sess = getSession(sid);
  if (!sess) return res.status(404).send("Not found");
  const id = parseInt(req.params.id);
  const report = sess.db.prepare("SELECT * FROM reports WHERE id=?").get(id);
  if (!report) return res.status(404).send("Not found");
  const sanitized = xssSanitize(report.content);
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Report #${id}</title>
<style>body{background:#0f1923;color:#c8d6e5;font-family:monospace;padding:40px}</style>
</head><body><h2>Report #${id}</h2><hr><div id="content">${sanitized}</div></body></html>`);
});

/* ═══════════════════════════════════════════════════
   Part 3 — Command Injection via Ping
   ═══════════════════════════════════════════════════ */
function pingFilter(input) {
  if (/[;&|`$(){}<>!'"\[\]\\]/.test(input)) return true;
  if (input.length > 50) return true;
  return false;
}

app.get("/challenge/ping", (req, res) => {
  const sid = req.query.sid || "";
  const sess = getSession(sid);
  if (!sess || !sess.authed || sess.role !== "administrator")
    return res.redirect("/challenge/login?sid=" + sid);
  res.send(
    page(
      "Network Diagnostics",
      `
    <h1>🔧 Network Diagnostics</h1>
    <div class="card">
      <label>Target IP Address</label>
      <input id="target" placeholder="e.g. 127.0.0.1" autocomplete="off">
      <br><br><button onclick="doPing()">Ping</button>
      <pre id="out" style="margin-top:15px;min-height:60px;"></pre>
    </div>
    <nav><a href="/challenge/dashboard?sid=${sid}">← Dashboard</a></nav>
    <script>
    async function doPing(){
      var t=document.getElementById('target').value;
      if(!/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(t)){document.getElementById('out').textContent='Error: Invalid IP format. Only digits and dots allowed.';return;}
      document.getElementById('out').textContent='Pinging...';
      try{
        var r=await fetch('/challenge/ping?sid=${sid}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:t})});
        var d=await r.json();
        document.getElementById('out').textContent=d.output||d.error||'No response';
      }catch(e){document.getElementById('out').textContent='Network error';}
    }
    document.getElementById('target').onkeydown=function(e){if(e.key==='Enter')doPing()};
    </script>
  `,
    ),
  );
});

app.post("/challenge/ping", (req, res) => {
  const sid = req.query.sid || "";
  const sess = getSession(sid);
  if (!sess || !sess.authed || sess.role !== "administrator")
    return res.json({ error: "Access denied" });
  const { target } = req.body;
  if (!target || typeof target !== "string")
    return res.json({ error: "Missing target" });
  if (pingFilter(target))
    return res.json({
      error: "Prohibited characters detected by server-side filter",
    });
  try {
    const out = execSync(`ping -c 1 -W 2 ${target}`, {
      timeout: 6000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return res.json({ output: out });
  } catch (e) {
    return res.json({ output: (e.stdout || "") + (e.stderr || "") });
  }
});

/* ═══════════════════════════════════════════════════
   Webhook system (per-user)
   ═══════════════════════════════════════════════════ */
app.get("/hook/:sid/events", (req, res) => {
  const sess = getSession(req.params.sid);
  if (!sess) return res.status(404).send("Unknown session");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  for (const evt of sess.webhooks)
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  sess.sse.push(res);
  req.on("close", () => {
    sess.sse = sess.sse.filter((c) => c !== res);
  });
});

app.all("/hook/:sid", (req, res) => {
  const sess = getSession(req.params.sid);
  if (!sess) return res.status(404).send("Unknown session");
  const evt = {
    time: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl,
    query: req.query,
    body: req.body,
    ua: req.headers["user-agent"] || "",
  };
  delete evt.query.sid;
  sess.webhooks.push(evt);
  if (sess.webhooks.length > 50) sess.webhooks.shift();
  for (const c of sess.sse) {
    try {
      c.write(`data: ${JSON.stringify(evt)}\n\n`);
    } catch (e) {}
  }
  res.set("Content-Type", "image/gif");
  res.send(
    Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64",
    ),
  );
});

/* ═══════════════════════════════════════════════════ */
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[TENGRI OS] Desktop challenge on port ${PORT}`);
  console.log(`[TENGRI OS] Flag1(SQLi):  ${FLAG1}`);
  console.log(`[TENGRI OS] Flag2(XSS):   HZU18{bl1nd_x55_m0ng0l_t4l1in_n4r}`);
  console.log(`[TENGRI OS] Flag3(CmdInj):${FLAG3}`);
});
