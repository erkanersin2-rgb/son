// LGS Asistan sunucusu: bağımlılıksız (yalnızca Node.js 22.13+), SQLite veritabanı
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
let DatabaseSync;
try { ({ DatabaseSync } = require("node:sqlite")); }
catch { console.error("HATA: Node " + process.version + " eski. Node 22.13 veya üstü gerekir. Render'da Environment bölümüne NODE_VERSION=24 ekleyin."); process.exit(1); }
console.log("Node " + process.version + " ile başlıyor, PORT=" + (process.env.PORT || 3000));
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
const COLS = ["accounts", "exams", "results", "resources", "schools", "ann", "notes", "msgs", "appts", "kb", "mem"];
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
let guide;
try { guide = require("./guide")({ rows, getDoc, putDoc, isStaff, aiUse, err }); }
catch (e) { console.error("guide.js yüklenemedi:", e.message); guide = async () => { throw err(503, "guide.js sunucuda bulunamadı veya hatalı (server.js ile aynı klasörde olmalı)"); }; }

// Şifre sıfırlama: RESET_TC ve RESET_PASSWORD ortam değişkenleri tanımlıysa rehber hesabı oluşturulur/güncellenir
if (/^\d{11}$/.test(process.env.RESET_TC || "") && (process.env.RESET_PASSWORD || "").length >= 6) {
  const tc = process.env.RESET_TC, old = getDoc("accounts", tc) || {};
  putDoc("accounts", tc, { name: "Rehber", ...old, tc, role: "rehber", ...hashPw(process.env.RESET_PASSWORD) });
  console.log("Rehber hesabı sıfırlandı: " + tc);
}

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
    case "notes": case "kb": case "mem": return S ? R : [];
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
  const p = url.pathname.slice(5).split("/").filter(Boolean), m = req.method, ip = req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : req.socket.remoteAddress;
  if (p[0] === "health") return json(res, 200, { ok: true });
  if (p[0] === "status" && m === "GET") return json(res, 200, { setup: q.cnt.get().n === 0, ai: !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY), provider: process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "anthropic") });
  if (p[0] === "guide-public" && m === "POST")
    return json(res, 200, await guide(null, JSON.parse((await body(req, 2e5)).toString() || "{}"), ip));
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
  if (p[0] === "guide" && m === "POST")
    return json(res, 200, await guide(u, JSON.parse((await body(req, 2e5)).toString() || "{}"), ip));
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

// Yedek: rehber.html dosyası depoda yoksa robot sayfası sunucunun içinden açılır
const REHBER_B64 = "PCFET0NUWVBFIGh0bWw+CjxodG1sIGxhbmc9InRyIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+PG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCxpbml0aWFsLXNjYWxlPTEiPgo8dGl0bGU+TEdTIFJlaGJlciBSb2JvdHU8L3RpdGxlPgo8c3R5bGU+Cjpyb290ey0tYmc6I2Y0ZjZmYjstLWNhcmQ6I2ZmZjstLWluazojMWQyNDMzOy0tbXV0OiM2Yjc0ODg7LS1wcmk6IzNiNWJkYjstLW1lOiMzYjViZGI7LS1ib3Q6I2VlZjFmOTstLWJkOiNkZmU0ZWZ9CkBtZWRpYShwcmVmZXJzLWNvbG9yLXNjaGVtZTpkYXJrKXs6cm9vdHstLWJnOiMxMjE2MjI7LS1jYXJkOiMxYjIxMzI7LS1pbms6I2U4ZWNmNjstLW11dDojOThhMmI4Oy0tcHJpOiM2YzhjZmY7LS1tZTojNGE2N2Q2Oy0tYm90OiMyNTJjNDI7LS1iZDojMmQzNTUwfX0KKntib3gtc2l6aW5nOmJvcmRlci1ib3h9aHRtbCxib2R5e2hlaWdodDoxMDAlO21hcmdpbjowfQpib2R5e2ZvbnQ6MTZweC8xLjUgc3lzdGVtLXVpLC1hcHBsZS1zeXN0ZW0sU2Vnb2UgVUksUm9ib3RvLHNhbnMtc2VyaWY7YmFja2dyb3VuZDp2YXIoLS1iZyk7Y29sb3I6dmFyKC0taW5rKTtkaXNwbGF5OmZsZXg7ZmxleC1kaXJlY3Rpb246Y29sdW1ufQpoZWFkZXJ7cGFkZGluZzoxMnB4IDE2cHg7YmFja2dyb3VuZDp2YXIoLS1jYXJkKTtib3JkZXItYm90dG9tOjFweCBzb2xpZCB2YXIoLS1iZCk7ZGlzcGxheTpmbGV4O2FsaWduLWl0ZW1zOmNlbnRlcjtnYXA6MTBweH0KaGVhZGVyIC5ib3R7Zm9udC1zaXplOjI4cHh9aGVhZGVyIGJ7ZGlzcGxheTpibG9ja31oZWFkZXIgc21hbGx7Y29sb3I6dmFyKC0tbXV0KX0KYnV0dG9ue2ZvbnQ6aW5oZXJpdDtjdXJzb3I6cG9pbnRlcjtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJkKTtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO2NvbG9yOnZhcigtLWluayk7Ym9yZGVyLXJhZGl1czoxMHB4O3BhZGRpbmc6OHB4IDEycHh9CmJ1dHRvbi5we2JhY2tncm91bmQ6dmFyKC0tcHJpKTtib3JkZXItY29sb3I6dmFyKC0tcHJpKTtjb2xvcjojZmZmfQp0ZXh0YXJlYXtmb250OmluaGVyaXQ7Y29sb3I6dmFyKC0taW5rKTtiYWNrZ3JvdW5kOnZhcigtLWJnKTtib3JkZXI6MXB4IHNvbGlkIHZhcigtLWJkKTtib3JkZXItcmFkaXVzOjEwcHg7cGFkZGluZzoxMHB4O3dpZHRoOjEwMCV9CiNjaGF0e2Rpc3BsYXk6ZmxleDtmbGV4OjE7bWluLWhlaWdodDowO2ZsZXgtZGlyZWN0aW9uOmNvbHVtbn0KI21zZ3N7ZmxleDoxO292ZXJmbG93OmF1dG87cGFkZGluZzoxNnB4O2Rpc3BsYXk6ZmxleDtmbGV4LWRpcmVjdGlvbjpjb2x1bW47Z2FwOjEwcHg7bWF4LXdpZHRoOjgyMHB4O3dpZHRoOjEwMCU7bWFyZ2luOjAgYXV0b30KLm17bWF4LXdpZHRoOjg4JTtwYWRkaW5nOjEwcHggMTRweDtib3JkZXItcmFkaXVzOjE2cHg7d29yZC13cmFwOmJyZWFrLXdvcmQ7b3ZlcmZsb3ctd3JhcDphbnl3aGVyZX0KLm0udXthbGlnbi1zZWxmOmZsZXgtZW5kO2JhY2tncm91bmQ6dmFyKC0tbWUpO2NvbG9yOiNmZmY7Ym9yZGVyLWJvdHRvbS1yaWdodC1yYWRpdXM6NHB4O3doaXRlLXNwYWNlOnByZS13cmFwfQoubS5ie2FsaWduLXNlbGY6ZmxleC1zdGFydDtiYWNrZ3JvdW5kOnZhcigtLWJvdCk7Ym9yZGVyLWJvdHRvbS1sZWZ0LXJhZGl1czo0cHh9Ci5tLmIgcHttYXJnaW46LjNlbSAwfS5tLmIgdWx7bWFyZ2luOi4zZW0gMDtwYWRkaW5nLWxlZnQ6MS4yZW19Ci5jaGlwc3tkaXNwbGF5OmZsZXg7ZmxleC13cmFwOndyYXA7Z2FwOjhweH0KLmNoaXBzIGJ1dHRvbntmb250LXNpemU6MTRweDtib3JkZXItcmFkaXVzOjk5OXB4fQojYmFye2JvcmRlci10b3A6MXB4IHNvbGlkIHZhcigtLWJkKTtiYWNrZ3JvdW5kOnZhcigtLWNhcmQpO3BhZGRpbmc6MTBweH0KI2JhciBkaXZ7bWF4LXdpZHRoOjgyMHB4O21hcmdpbjowIGF1dG87ZGlzcGxheTpmbGV4O2dhcDo4cHg7YWxpZ24taXRlbXM6ZmxleC1lbmR9CiNiYXIgdGV4dGFyZWF7cmVzaXplOm5vbmU7bWF4LWhlaWdodDoxNDBweH0KLmRvdHMgc3BhbnthbmltYXRpb246YiAxcyBpbmZpbml0ZTtkaXNwbGF5OmlubGluZS1ibG9ja30uZG90cyBzcGFuOm50aC1jaGlsZCgyKXthbmltYXRpb24tZGVsYXk6LjJzfS5kb3RzIHNwYW46bnRoLWNoaWxkKDMpe2FuaW1hdGlvbi1kZWxheTouNHN9CkBrZXlmcmFtZXMgYns1MCV7b3BhY2l0eTouMn19Cjwvc3R5bGU+PC9oZWFkPjxib2R5Pgo8aGVhZGVyPjxzcGFuIGNsYXNzPSJib3QiPvCfpJY8L3NwYW4+PGRpdj48Yj5MR1MgUmVoYmVyIFJvYm90dTwvYj48c21hbGw+QWtsxLFuZGFraSBoZXIgc29ydXl1IHNvcmFiaWxpcnNpbjwvc21hbGw+PC9kaXY+PC9oZWFkZXI+CjxzZWN0aW9uIGlkPSJjaGF0Ij48ZGl2IGlkPSJtc2dzIj48L2Rpdj4KPGRpdiBpZD0iYmFyIj48ZGl2Pjx0ZXh0YXJlYSBpZD0iaW4iIHJvd3M9IjEiIHBsYWNlaG9sZGVyPSJTb3J1bnUgeWF64oCmIChFbnRlciBpbGUgZ8O2bmRlcikiPjwvdGV4dGFyZWE+PGJ1dHRvbiBjbGFzcz0icCIgaWQ9InNlbmQiPkfDtm5kZXI8L2J1dHRvbj48L2Rpdj48L2Rpdj48L3NlY3Rpb24+CjxzY3JpcHQ+CmNvbnN0ICQ9cz0+ZG9jdW1lbnQucXVlcnlTZWxlY3RvcihzKTsKbGV0IGhpc3Q9W10sYnVzeT1mYWxzZTsKY29uc3QgZXNjPXM9PnMucmVwbGFjZSgvWyY8PiJdL2csYz0+KHsiJiI6IiZhbXA7IiwiPCI6IiZsdDsiLCI+IjoiJmd0OyIsJyInOiImcXVvdDsifVtjXSkpOwpmdW5jdGlvbiBtZCh0KXsKICBjb25zdCBpbmw9cz0+ZXNjKHMpLnJlcGxhY2UoL1wqXCooLis/KVwqXCovZywiPGI+JDE8L2I+IikucmVwbGFjZSgvYCguKz8pYC9nLCI8Y29kZT4kMTwvY29kZT4iKTsKICBsZXQgb3V0PSIiLHVsPWZhbHNlOwogIGZvcihjb25zdCBsIG9mIHQuc3BsaXQoIlxuIikpewogICAgY29uc3QgbGk9bC5tYXRjaCgvXlxzKlstKuKAol1ccysoLiopLyl8fGwubWF0Y2goL15ccypcZCtbLildXHMrKC4qKS8pOwogICAgaWYobGkpe2lmKCF1bCl7b3V0Kz0iPHVsPiI7dWw9dHJ1ZX1vdXQrPSI8bGk+IitpbmwobGlbMV0pKyI8L2xpPiJ9CiAgICBlbHNle2lmKHVsKXtvdXQrPSI8L3VsPiI7dWw9ZmFsc2V9aWYobC50cmltKCkpb3V0Kz0iPHA+IitpbmwobC5yZXBsYWNlKC9eIytccyovLCIiKSkrIjwvcD4ifQogIH0KICByZXR1cm4gb3V0Kyh1bD8iPC91bD4iOiIiKTsKfQphc3luYyBmdW5jdGlvbiBhcGkocGF0aCxvcHQ9e30pewogIGlmKGxvY2F0aW9uLnByb3RvY29sPT09ImZpbGU6Iil0aHJvdyBuZXcgRXJyb3IoIkJ1IHNheWZhecSxIGRvc3lhZGFuIGRlxJ9pbCwgc3VudWN1IGFkcmVzaW5kZW4gYcOnICjDtnJuLiBodHRwOi8vbG9jYWxob3N0OjMwMDAvcmVoYmVyLmh0bWwgdmV5YSBSZW5kZXIgYWRyZXNpbi9yZWhiZXIuaHRtbCkuIik7CiAgY29uc3Qgcj1hd2FpdCBmZXRjaCgiL2FwaS8iK3BhdGgsey4uLm9wdCxoZWFkZXJzOnsiQ29udGVudC1UeXBlIjoiYXBwbGljYXRpb24vanNvbiJ9fSk7CiAgY29uc3Qgaj1hd2FpdCByLmpzb24oKS5jYXRjaCgoKT0+bnVsbCk7aWYoIWopdGhyb3cgbmV3IEVycm9yKCJTdW51Y3VkYW4gZ2XDp2VybGkgeWFuxLF0IGdlbG1lZGkgKEhUVFAgIityLnN0YXR1cysiKS4gU3VudWN1IGHDp8SxayBtxLEgdmUgL2FwaSDDp2FsxLHFn8SxeW9yIG11PyIpO2lmKCFyLm9rKXRocm93IG5ldyBFcnJvcihqLmVycm9yfHwiSGF0YSIpO3JldHVybiBqOwp9CmZ1bmN0aW9uIGFkZChjbHMsaHRtbCl7Y29uc3QgZD1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTtkLmNsYXNzTmFtZT0ibSAiK2NscztkLmlubmVySFRNTD1odG1sOyQoIiNtc2dzIikuYXBwZW5kQ2hpbGQoZCk7ZC5zY3JvbGxJbnRvVmlldyh7YmxvY2s6ImVuZCJ9KTtyZXR1cm4gZH0KZnVuY3Rpb24gY2hpcHMobGlzdCl7CiAgY29uc3QgZD1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTtkLmNsYXNzTmFtZT0iY2hpcHMiOwogIGxpc3QuZm9yRWFjaChxPT57Y29uc3QgYj1kb2N1bWVudC5jcmVhdGVFbGVtZW50KCJidXR0b24iKTtiLnRleHRDb250ZW50PXE7Yi5vbmNsaWNrPSgpPT57ZC5yZW1vdmUoKTthc2socSl9O2QuYXBwZW5kQ2hpbGQoYil9KTsKICAkKCIjbXNncyIpLmFwcGVuZENoaWxkKGQpOwp9CmFkZCgiYiIsYDxwPk1lcmhhYmEhIEJlbiBMR1MgUmVoYmVyIFJvYm90dXl1bS4g8J+RizwvcD48cD5EZXJzIHNvcnVsYXLEsW7EsSDDp8O2emViaWxpciwgZGVuZW1lIG5ldGxlcmluaSB5b3J1bWxheWFiaWxpciwgw6dhbMSxxZ9tYSBwbGFuxLEgw6fEsWthcmFiaWxpciwgdGVyY2loIHZlIHPEsW5hdiB0ZWtuacSfaSBrb251c3VuZGEgw7ZuZXJpIHZlcmViaWxpcmltLiBEZW5lbWUgbmV0bGVyaW5pIHlhemFyc2FuIHlvcnVtbGFyxLFtLiBOZXlsZSBiYcWfbGF5YWzEsW0/PC9wPmApOwpjaGlwcyhbIkJ1IGhhZnRhIGnDp2luIMOnYWzEscWfbWEgcGxhbsSxIHlhcCIsIk5ldGxlcmltaSB5YXphecSxbSwgeW9ydW1sYXIgbcSxc8Sxbj8iLCJTxLFuYXYga2F5Z8Sxc8SxeWxhIG5hc8SxbCBiYcWfYSDDp8Sxa2FyxLFtPyIsIllhbmzEscWfIGRlZnRlcmkgbmFzxLFsIHR1dHVsdXI/IiwiVGVyY2loIHlhcGFya2VuIG5lbGVyZSBiYWttYWzEsXnEsW0/IiwiQmFuYSBiaXIga29udSBhbmxhdCJdKTsKYXN5bmMgZnVuY3Rpb24gYXNrKHRleHQpewogIHRleHQ9dGV4dC50cmltKCk7aWYoIXRleHR8fGJ1c3kpcmV0dXJuO2J1c3k9dHJ1ZTsKICBhZGQoInUiLGVzYyh0ZXh0KSk7aGlzdC5wdXNoKHtyb2xlOiJ1c2VyIixjb250ZW50OnRleHR9KTskKCIjaW4iKS52YWx1ZT0iIjskKCIjaW4iKS5zdHlsZS5oZWlnaHQ9ImF1dG8iOwogIGNvbnN0IHc9YWRkKCJiIiwnPHNwYW4gY2xhc3M9ImRvdHMiPjxzcGFuPuKXjzwvc3Bhbj48c3Bhbj7il488L3NwYW4+PHNwYW4+4pePPC9zcGFuPjwvc3Bhbj4nKTsKICB0cnl7CiAgICBjb25zdCB7dGV4dDphfT1hd2FpdCBhcGkoImd1aWRlLXB1YmxpYyIse21ldGhvZDoiUE9TVCIsYm9keTpKU09OLnN0cmluZ2lmeSh7bWVzc2FnZXM6aGlzdH0pfSk7CiAgICBoaXN0LnB1c2goe3JvbGU6ImFzc2lzdGFudCIsY29udGVudDphfSk7dy5pbm5lckhUTUw9bWQoYSk7CiAgfWNhdGNoKGUpe2hpc3QucG9wKCk7dy5pbm5lckhUTUw9IjxwPuKaoO+4jyAiK2VzYyhlLm1lc3NhZ2UpKyI8L3A+In0KICBidXN5PWZhbHNlO3cuc2Nyb2xsSW50b1ZpZXcoe2Jsb2NrOiJlbmQifSk7Cn0KJCgiI3NlbmQiKS5vbmNsaWNrPSgpPT5hc2soJCgiI2luIikudmFsdWUpOwokKCIjaW4iKS5hZGRFdmVudExpc3RlbmVyKCJrZXlkb3duIixlPT57aWYoZS5rZXk9PT0iRW50ZXIiJiYhZS5zaGlmdEtleSl7ZS5wcmV2ZW50RGVmYXVsdCgpO2FzaygkKCIjaW4iKS52YWx1ZSl9fSk7CiQoIiNpbiIpLmFkZEV2ZW50TGlzdGVuZXIoImlucHV0IixlPT57ZS50YXJnZXQuc3R5bGUuaGVpZ2h0PSJhdXRvIjtlLnRhcmdldC5zdHlsZS5oZWlnaHQ9ZS50YXJnZXQuc2Nyb2xsSGVpZ2h0KyJweCJ9KTsKPC9zY3JpcHQ+PC9ib2R5PjwvaHRtbD4K";

// Statik dosya bulucu: public/ içinde arar; rehber.html gibi bilinen dosyaları ana klasörde de bulur
const PUB = path.join(__dirname, "public"), ROOT_OK = new Set(["index.html", "rehber.html", "bilgi-bankasi.html"]);
function findStatic(p) {
  let cands;
  if (p === "/") cands = [path.join(PUB, "index.html"), path.join(PUB, "rehber.html"), path.join(__dirname, "rehber.html")];
  else {
    const name = path.normalize(p).replace(/^(\.\.[/\\])+/, "");
    cands = [path.join(PUB, name)]; if (ROOT_OK.has(path.basename(name))) cands.push(path.join(__dirname, path.basename(name)));
  }
  return cands.find(f => (f.startsWith(PUB + path.sep) || path.dirname(f) === __dirname) && fs.existsSync(f) && fs.statSync(f).isFile());
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    const f = findStatic(url.pathname);
    if (!f && (url.pathname === "/" || url.pathname === "/rehber.html")) { // dosya yoksa gömülü robot sayfasını ver
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(Buffer.from(REHBER_B64, "base64"));
    }
    if (!f) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Bulunamadı"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  } catch (e) {
    if (!e.status) console.error(e);
    json(res, e.status || 500, { error: e.status ? e.message : "Sunucu hatası" });
  }
}).listen(PORT, "0.0.0.0", () => console.log("LGS Asistan http://localhost:" + PORT));
