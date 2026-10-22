// LGS Asistan sunucusu: bağımlılıksız (yalnızca Node.js 22.13+), SQLite veritabanı
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(path.join(DATA, "files"), { recursive: true });
const SECRET = process.env.SECRET || (() => {
  const f = path.join(DATA, "secret");
  if (fs.existsSync(f)) return fs.readFileSync(f, "utf8");
  const s = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(f, s, { mode: 0o600 }); return s;
})();
const db = new DatabaseSync(path.join(DATA, "lgs.db"));
db.exec("CREATE TABLE IF NOT EXISTS docs(col TEXT, id TEXT, data TEXT, PRIMARY KEY(col,id))");
const COLS = ["accounts", "exams", "results", "resources", "schools", "ann", "notes", "msgs", "appts", "programs"];
const q = {
  all: db.prepare("SELECT id,data FROM docs WHERE col=?"),
  one: db.prepare("SELECT data FROM docs WHERE col=? AND id=?"),
  put: db.prepare("INSERT OR REPLACE INTO docs(col,id,data) VALUES(?,?,?)"),
  del: db.prepare("DELETE FROM docs WHERE col=? AND id=?"),
  cnt: db.prepare("SELECT COUNT(*) n FROM docs WHERE col='accounts'"),
};
const rows = c => q.all.all(c).map(r => ({ id: r.id, ...JSON.parse(r.data) }));
const getDoc = (c, id) => { const r = q.one.get(c, id); return r ? JSON.parse(r.data) : null; };
const putDoc = (c, id, d) => q.put.run(c, id, JSON.stringify(d));

// ---- yardımcılar
const err = (status, error) => Object.assign(new Error(error), { status });
const isStaff = u => u.role === "rehber" || u.role === "brans";
const alias = tc => crypto.createHmac("sha256", SECRET).update("al" + tc).digest("hex").slice(0, 12);
const unalias = a => { const m = rows("accounts").find(x => alias(x.tc) === a); return m ? m.tc : a; };
const hashPw = (pw, salt = crypto.randomBytes(16).toString("hex")) =>
  ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString("hex") });
const checkPw = (pw, a) => { try { return crypto.timingSafeEqual(Buffer.from(hashPw(pw, a.salt).hash, "hex"), Buffer.from(a.hash, "hex")); } catch { return false; } };
const mkToken = tc => { const p = Buffer.from(JSON.stringify({ tc, exp: Date.now() + 12 * 36e5 })).toString("base64url"); return p + "." + crypto.createHmac("sha256", SECRET).update(p).digest("base64url"); };
const readToken = t => {
  try {
    const [p, s] = String(t).split(".");
    const ok = crypto.createHmac("sha256", SECRET).update(p).digest("base64url") === s;
    const d = JSON.parse(Buffer.from(p, "base64url")); if (!ok || d.exp < Date.now()) return null;
    return getDoc("accounts", d.tc);
  } catch { return null; }
};
const pub = a => { const { salt, hash, ...r } = a; return r; };
const tries = new Map();
const limited = k => { const n = Date.now(), l = (tries.get(k) || []).filter(t => n - t < 9e5); tries.set(k, l); return l.length >= 8; };
const fail = k => tries.set(k, [...(tries.get(k) || []), Date.now()]);
const aiUse = new Map();

// ---- okuma kuralları (sunucu tarafı yetkilendirme)
function readCol(col, u) {
  const R = rows(col), S = isStaff(u);
  switch (col) {
    case "accounts":
      if (S) return R.map(pub);
      return R.filter(a => a.tc === u.tc || (u.role === "veli" && a.tc === u.child) || isStaff(a))
        .map(a => (a.tc === u.tc || a.tc === u.child) ? pub(a) : { id: alias(a.tc), tc: alias(a.tc), name: a.name, role: a.role, branch: a.branch });
    case "results":
      if (S) return R;
      return R.map(r => (r.tc === u.tc || (u.role === "veli" && r.tc === u.child)) ? r
        : { id: "a_" + alias(r.tc) + "_" + r.exam, exam: r.exam, tc: "anon", r: r.r, date: r.date });
    case "notes": return S ? R : [];
    case "programs": return S ? R : R.filter(p => p.tc === u.tc || (u.role === "veli" && p.tc === u.child));
    case "msgs":
      if (S) return R;
      return R.filter(m => m.from === u.tc || m.to === u.tc).map(m => m.from === u.tc ? m : { ...m, from: alias(m.from) });
    case "appts":
      if (S) return R;
      return R.filter(a => a.tc === u.tc).map(a => ({ ...a, with: alias(a.with) }));
    default: return R;
  }
}

// ---- yazma kuralları
function writeDoc(col, op, id, body, u) {
  const S = isStaff(u), old = id ? getDoc(col, id) : null, now = new Date().toISOString();
  if (col === "msgs") {
    if (op === "delete") { if (!S) throw err(403, "Yetkisiz"); return { del: true }; }
    if (op !== "add") throw err(403, "Mesaj değiştirilemez");
    return { data: { from: u.tc, fromName: u.name, fromRole: u.role, to: S ? String(body.to || "") : "staff", text: String(body.text || "").slice(0, 4000), date: now, ...(body.file ? { file: { id: String(body.file.id), name: String(body.file.name).slice(0, 200) } } : {}) } };
  }
  if (col === "appts") {
    if (op === "add" && !S) return { data: { tc: u.tc, name: u.name, role: u.role, with: unalias(String(body.with || "")), date: String(body.date), time: String(body.time), note: String(body.note || "").slice(0, 500), status: "bekliyor" } };
    if (op === "update") {
      if (S) return { data: { ...old, ...body } };
      if (old && old.tc === u.tc && old.status === "bekliyor" && body.status === "iptal edildi") return { data: { ...old, status: "iptal edildi" } };
      throw err(403, "Yetkisiz");
    }
    throw err(403, "Yetkisiz");
  }
  if (col === "programs") {
    const own = old && old.tc === u.tc;
    if (S) return op === "delete" ? { del: true } : { data: op === "update" ? { ...old, ...body } : body };
    if (u.role !== "ogrenci") throw err(403, "Yetkisiz");
    if (op === "delete") { if (!own) throw err(403, "Yetkisiz"); return { del: true }; }
    if (op !== "add" && !own) throw err(403, "Yetkisiz");
    const d = { ...body, tc: u.tc, name: u.name };
    if (JSON.stringify(d).length > 2e5) throw err(413, "Program çok büyük");
    return { data: op === "update" ? { ...old, ...d } : d };
  }
  if (!S) throw err(403, "Yetkisiz");
  if (col === "accounts") {
    if (u.role !== "rehber") throw err(403, "Hesapları yalnızca rehber yönetebilir");
    if (op === "delete") { if (id === u.tc) throw err(400, "Kendi hesabını silemezsin"); return { del: true }; }
    const d = { ...(op === "update" ? old : {}), ...body };
    const pw = d.password; delete d.password;
    if (!/^\d{11}$/.test(String(d.tc || id)) || (d.tc && d.tc !== id)) throw err(400, "Geçersiz TC");
    if (!["ogrenci", "veli", "brans", "rehber"].includes(d.role)) throw err(400, "Geçersiz rol");
    if (pw || !old) { if (!pw || pw.length < 6) throw err(400, "Şifre en az 6 karakter olmalı"); Object.assign(d, hashPw(pw)); }
    else { d.salt = old.salt; d.hash = old.hash; }
    return { data: d };
  }
  if (op === "delete") return { del: true };
  return { data: op === "update" ? { ...old, ...body } : body };
}

// ---- HTTP
const body = (req, max) => new Promise((ok, no) => {
  const c = []; let n = 0;
  req.on("data", d => { n += d.length; if (n > max) { no(err(413, "Dosya çok büyük")); req.destroy(); } else c.push(d); });
  req.on("end", () => ok(Buffer.concat(c))); req.on("error", no);
});
const json = (res, st, o) => { res.writeHead(st, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon" };
const SAFE = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/;

async function api(req, res, url) {
  const p = url.pathname.slice(5).split("/").filter(Boolean), m = req.method, ip = req.socket.remoteAddress;
  if (p[0] === "status" && m === "GET") return json(res, 200, { setup: q.cnt.get().n === 0 });
  if ((p[0] === "setup" || p[0] === "login") && m === "POST") {
    const b = JSON.parse((await body(req, 1e5)).toString() || "{}"), key = ip + ":" + b.tc;
    if (limited(key)) throw err(429, "Çok fazla deneme. 15 dakika sonra tekrar dene.");
    if (p[0] === "setup") {
      if (q.cnt.get().n) throw err(403, "Kurulum zaten yapılmış");
      if (!/^\d{11}$/.test(b.tc) || !b.password || b.password.length < 6) throw err(400, "11 haneli TC ve en az 6 karakterli şifre gerekli");
      const a = { tc: b.tc, name: b.name || "Rehber", role: "rehber", ...hashPw(b.password) };
      putDoc("accounts", a.tc, a); return json(res, 200, { token: mkToken(a.tc), user: pub(a) });
    }
    const a = getDoc("accounts", String(b.tc));
    if (!a || !checkPw(String(b.password || ""), a)) { fail(key); throw err(401, "TC veya şifre hatalı"); }
    return json(res, 200, { token: mkToken(a.tc), user: pub(a) });
  }
  const tok = (req.headers.authorization || "").replace(/^Bearer /, "") || url.searchParams.get("t");
  const u = readToken(tok); if (!u) throw err(401, "Oturum gerekli");
  if (p[0] === "me") return json(res, 200, { user: pub(u) });
  if (p[0] === "c" && COLS.includes(p[1])) {
    if (m === "GET") return json(res, 200, readCol(p[1], u));
    if (m === "POST") {
      const r = writeDoc(p[1], "add", null, JSON.parse((await body(req, 1e6)).toString()), u), id = crypto.randomBytes(8).toString("hex");
      putDoc(p[1], id, r.data); return json(res, 200, { id });
    }
  }
  if (p[0] === "d" && COLS.includes(p[1]) && p[2]) {
    const op = { PUT: "set", PATCH: "update", DELETE: "delete" }[m]; if (!op) throw err(405, "Yöntem yok");
    const b = op === "delete" ? {} : JSON.parse((await body(req, 1e6)).toString());
    if (op === "update" && !getDoc(p[1], p[2])) throw err(404, "Kayıt yok");
    const r = writeDoc(p[1], op, p[2], b, u);
    if (r.del) q.del.run(p[1], p[2]); else putDoc(p[1], p[2], r.data);
    return json(res, 200, { ok: true });
  }
  if (p[0] === "upload" && m === "POST") {
    if (!isStaff(u)) throw err(403, "Yetkisiz");
    const buf = await body(req, 20e6), id = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(path.join(DATA, "files", id), buf);
    fs.writeFileSync(path.join(DATA, "files", id + ".json"), JSON.stringify({ type: req.headers["content-type"] || "", name: decodeURIComponent(req.headers["x-filename"] || "dosya") }));
    return json(res, 200, { id, url: "/api/file/" + id });
  }
  if (p[0] === "file" && /^[a-f0-9]{32}$/.test(p[1] || "")) {
    const f = path.join(DATA, "files", p[1]); if (!fs.existsSync(f)) throw err(404, "Dosya yok");
    const meta = JSON.parse(fs.readFileSync(f + ".json", "utf8")), safe = SAFE.test(meta.type);
    res.writeHead(200, { "Content-Type": safe ? meta.type : "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Disposition": (safe ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(meta.name) });
    return fs.createReadStream(f).pipe(res);
  }
  if (p[0] === "ai" && m === "POST") {
    if (!process.env.ANTHROPIC_API_KEY) throw err(503, "Yapay zeka anahtarı (ANTHROPIC_API_KEY) tanımlı değil");
    const n = Date.now(), l = (aiUse.get(u.tc) || []).filter(t => n - t < 36e5); if (l.length >= 60) throw err(429, "Saatlik yapay zeka sınırına ulaşıldı");
    aiUse.set(u.tc, [...l, n]);
    const b = JSON.parse((await body(req, 15e6)).toString()), imgs = (b.images || []).slice(0, 6);
    if (imgs.length && !isStaff(u)) throw err(403, "Yetkisiz");
    const msgs = typeof b.input === "string" ? [{ role: "user", content: b.input }] : b.input;
    const last = msgs[msgs.length - 1];
    last.content = [...imgs.map(i => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })), { type: "text", text: String(last.content) }];
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5", max_tokens: 2000, messages: msgs }),
    });
    const j = await r.json(); if (!r.ok) throw err(502, "Yapay zeka hatası: " + (j.error && j.error.message || r.status));
    return json(res, 200, { text: (j.content || []).filter(c => c.type === "text").map(c => c.text).join("") });
  }
  throw err(404, "Bulunamadı");
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const f = path.join(__dirname, "public", url.pathname === "/" ? "index.html" : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ""));
    if (!f.startsWith(path.join(__dirname, "public")) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("Bulunamadı"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  } catch (e) {
    if (!e.status) console.error(e);
    json(res, e.status || 500, { error: e.status ? e.message : "Sunucu hatası" });
  }
}).listen(PORT, () => console.log("LGS Asistan http://localhost:" + PORT));
