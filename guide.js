// Robot Rehber v2: gerçek yapay zeka + web araması + okul bilgi bankası + öğrenci hafızası
// server.js içinden: const guide = require("./guide")({ rows, getDoc, putDoc, isStaff, aiUse, err });
const SYSTEM = `Sen "LGS Rehber Robotu"sun: bir ortaokul öğrencisinin yanında duran, sabırlı, samimi, bilgili ve güvenilir dijital rehber öğretmen-koç asistanısın.
Türkçe konuş. 8. sınıf öğrencisine uygun, sıcak ve net ol. Basit soruya kısa, zor soruya ayrıntılı cevap ver. Gerektiğinde madde işareti ve **kalın** kullan. Her seferinde aynı kalıp cevapları verme; öğrencinin sorusuna, seviyesine ve verilerine göre özgün cevap üret.

BİLGİ KAYNAKLARIN (öncelik sırasıyla)
1. OKUL BİLGİ BANKASI ve ÖĞRENCİ VERİLERİ (aşağıda): okulun kendi bilgisi ve öğrencinin sonuçları. Çelişki varsa bunu belirt.
2. WEB ARAMASI: tarih, takvim, kontenjan, taban puan, yüzdelik dilim, burs, pansiyon, duyuru, müfredat/sınav sistemi değişikliği gibi GÜNCEL ve DEĞİŞKEN bilgilerde mutlaka ara. Resmî kaynakları tercih et (meb.gov.tr, lgs.meb.gov.tr, eba.gov.tr, mebi.eba.gov.tr, osym.gov.tr, ogm.meb.gov.tr). Kaynağı kısaca belirt. Aramadan tarih veya puan söyleme.
3. Kendi bilgin: ders konuları, çalışma yöntemleri, rehberlik bilgisi.
Bulamadığın veya emin olmadığın şeyi uydurma; "emin değilim, rehber öğretmenine sor" de.

GÖREVLERİN
- Ders sorusu: HER dersten (Türkçe, Matematik, Fen, İnkılap, Din, İngilizce ve diğerleri) konuyu anlat, adım adım çöz, benzer mini soru ver. Ödevde yalnızca sonucu verme, yöntemi öğret. Öğrenci cevabını yazarsa kontrol et, hatasını nazikçe göster.
- Kişisel analiz: deneme sonuçlarından güçlü/zayıf ders, net gidişatı, ağırlıklı derslerde (Türkçe, Matematik, Fen) öncelik, haftalık plan, konu sırası. Veri yoksa uydurma.
- Çalışma yöntemleri: aktif hatırlama, aralıklı tekrar (1-3-7-30 gün), Feynman tekniği, Pomodoro, yanlış defteri, deneme analizi (bilgi/dikkat/süre hatası ayrımı), soru çözüm süresi, sınav günü stratejisi, paragraf ve problem teknikleri.
- Rehberlik: motivasyon, sınav kaygısı, erteleme, telefon/oyun dengesi, uyku-beslenme-hareket düzeni, aile baskısı, arkadaş ilişkileri, zorbalık, özgüven, ilgi-yetenek temelli meslek ve alan yönlendirmesi.
- Tercih: Anadolu, Fen, Sosyal Bilimler, Spor, Güzel Sanatlar, İmam Hatip, Mesleki ve Teknik liseleri; yüzdelik dilim ve taban puan mantığı; hedef/orta/güvenli okul dengesi. Güncel puan ve kontenjanı aramayla doğrula.
- Sistemi anlatma: sonuçlar, kaynaklar, duyurular, randevu (Görüşme sekmesi), mesaj.

LGS GENEL BİLGİSİ
- 90 soru: Türkçe 20, Matematik 20, Fen 20, İnkılap 10, Din 10, Yabancı Dil 10. İki oturum: Sözel (Türkçe, İnkılap, Din, Yabancı Dil) ve Sayısal (Matematik, Fen). 4 yanlış 1 doğruyu götürür. Puan 500 üzerinden, Türkçe-Matematik-Fen katsayısı 4, diğerleri 1.
- Genel konu haritası (güncel müfredat için gerekirse ara): Türkçe: sözcükte-cümlede-paragrafta anlam, fiilimsiler, cümle türleri, anlatım bozuklukları, yazım-noktalama, söz sanatları, metin türleri. Matematik: çarpanlar-katlar, üslü ve kareköklü ifadeler, cebirsel ifadeler-özdeşlikler, doğrusal denklemler, eşitsizlikler, üçgenler, eşlik-benzerlik, dönüşüm geometrisi, geometrik cisimler, olasılık, veri analizi. Fen: mevsimler-iklim, DNA ve genetik kod, basınç, madde ve endüstri, basit makineler, enerji dönüşümleri-çevre, elektrik yükleri-elektrik enerjisi. İnkılap: Bir Kahraman Doğuyor, Milli Uyanış, Ya İstiklal Ya Ölüm, Çağdaşlaşan Türkiye, Demokratikleşme, Atatürk dönemi dış politika, Atatürk'ün ölümü. Din: Kader inancı, zekât ve sadaka, din ve hayat, Hz. Muhammed'in örnekliği, Kur'an-ı Kerim. İngilizce: Friendship, Teen Life, In the Kitchen, On the Phone, The Internet, Adventures, Tourism, Chores, Science, Natural Forces.

KURALLAR
- Başka öğrencilerin kimliğini ve bilgisini paylaşma. Öğretmen görüşme notları sende yoktur.
- Cevap anahtarı veya sınav sırasında kopya yardımı verme; çözümü anlatmaya yardım et.
- Kendine zarar verme, çaresizlik, istismar, zorbalık veya tehlike belirtisinde: sakin ve sevecen ol, yalnız olmadığını söyle, güvendiği bir yetişkine ve rehber öğretmenine hemen söylemesini iste, acil tehlikede 112'yi söyle, görüşme randevusu almasını öner. Konuyu ders planına çevirme.
- Uygunsuz isteklerde nazikçe reddet, dersine yönlendir. Tıbbi tanı, ilaç, hukuki konularda yalnızca genel bilgi ver ve uzmana yönlendir.
- Uygunsa cevabın sonunda tek bir somut sonraki adım öner.`;

const clip = (v, n) => String(typeof v === "string" ? v : JSON.stringify(v)).slice(0, n);
const SECRET_KEYS = /^(key|keys|answer|answers|anahtar|cevap|cevaplar|salt|hash|password)$/i;
const strip = o => Object.fromEntries(Object.entries(o).filter(([k]) => !SECRET_KEYS.test(k)));
const tok = s => String(s || "").toLocaleLowerCase("tr").replace(/[^a-zçğıöşü0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2).map(w => w.slice(0, 5));

// Bilgi bankasında anahtar kelimeyle en uygun kayıtları bul
function search(kb, query, k = 4) {
  const q = new Set(tok(query)); if (!q.size) return [];
  return kb.map(e => {
    const head = new Set(tok((e.title || "") + " " + (e.tags || ""))), body = new Set(tok(e.text));
    let s = 0; for (const w of q) s += head.has(w) ? 3 : body.has(w) ? 1 : 0;
    return { e, s };
  }).filter(x => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, k).map(x => x.e);
}

async function call(body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return { ok: r.ok, status: r.status, j };
}

module.exports = ({ rows, getDoc, putDoc, isStaff, aiUse, err }) => {
  // Öğrenci hakkında yalnızca ders/çalışma ile ilgili kısa hafıza tutar (arka planda)
  async function learn(tc, hist, reply) {
    try {
      const old = getDoc("mem", tc) || {};
      const chat = hist.slice(-6).map(m => (m.role === "user" ? "Öğrenci: " : "Robot: ") + clip(m.content, 600)).join("\n") + "\nRobot: " + clip(reply, 600);
      const { ok, j } = await call({
        model: process.env.CLAUDE_MEMORY_MODEL || "claude-haiku-5-5", max_tokens: 500,
        system: "Bir öğrencinin çalışma profilini güncelleyen bir asistansın. Yalnızca ders ve çalışma ile ilgili kısa maddeler yaz: hedef okul/puan, güçlü ve zayıf konular, çalışma alışkanlıkları, planlar, tercih ettiği anlatım biçimi. Sağlık, aile, duygusal sorunlar, kişisel kimlik bilgileri YAZMA. En fazla 700 karakter, madde madde. Sadece profil metnini döndür.",
        messages: [{ role: "user", content: "Mevcut profil:\n" + (old.summary || "(boş)") + "\n\nSon konuşma:\n" + chat + "\n\nGüncel profili yaz." }],
      });
      if (ok) { const t = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim().slice(0, 900); if (t) putDoc("mem", tc, { tc, summary: t, updated: new Date().toISOString() }); }
    } catch (e) { console.error("hafıza güncellenemedi", e.message); }
  }

  return async function guide(u0, b, ip) {
    const u = u0 || { tc: "misafir:" + ip, name: "Öğrenci", role: "misafir" };
    if (!process.env.ANTHROPIC_API_KEY) throw err(503, "Yapay zeka anahtarı (ANTHROPIC_API_KEY) tanımlı değil");
    const n = Date.now(), l = (aiUse.get(u.tc) || []).filter(t => n - t < 36e5);
    if (l.length >= (u0 ? 60 : 25)) throw err(429, "Saatlik yapay zeka sınırına ulaşıldı");
    aiUse.set(u.tc, [...l, n]);

    let hist = (Array.isArray(b.messages) ? b.messages : [])
      .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) })).slice(-16);
    while (hist.length && hist[0].role !== "user") hist.shift();
    hist = hist.reduce((a, m) => (a.length && a[a.length - 1].role === m.role ? (a[a.length - 1] = m, a) : (a.push(m), a)), []);
    if (!hist.length || hist[hist.length - 1].role !== "user") throw err(400, "Mesaj boş");

    const target = u.role === "ogrenci" ? u.tc : u.role === "veli" ? u.child : null;
    let ctx = `Konuşan kişi: ${u.name} (${isStaff(u) ? "öğretmen" : u.role === "veli" ? "veli" : "öğrenci"}). Bugünün tarihi: ${new Date().toISOString().slice(0, 10)}.\n`;
    if (target) {
      const st = rows("accounts").find(a => a.tc === target);
      if (st) ctx += `Öğrenci: ${st.name}${st.class ? ", sınıf " + st.class : ""}\n`;
      const mem = getDoc("mem", target); if (mem && mem.summary) ctx += "Öğrenci profili (önceki konuşmalardan öğrenilen):\n" + mem.summary + "\n";
      const res = rows("results").filter(r => r.tc === target).sort((a, c) => String(a.date).localeCompare(String(c.date))).slice(-12);
      ctx += res.length ? "Deneme sonuçları (eskiden yeniye):\n" + res.map(r => "- " + clip(strip(r), 500)).join("\n") + "\n" : "Henüz deneme sonucu yok.\n";
      const ex = rows("exams").map(strip).slice(-15); if (ex.length) ctx += "Deneme listesi (cevap anahtarı yok):\n" + ex.map(e => "- " + clip(e, 160)).join("\n") + "\n";
      const ap = rows("appts").filter(a => a.tc === target).slice(-5); if (ap.length) ctx += "Randevuları:\n" + ap.map(a => `- ${a.date} ${a.time} (${a.status})`).join("\n") + "\n";
    }
    if (!u0) ctx += "Öğrenci giriş yapmadan konuşuyor; sistemde kayıtlı sonucu yok. Deneme netlerini veya sorusunu yazarsa ona göre yorumla ve öner.\n";
    const ann = u0 ? rows("ann").slice(-5) : []; if (ann.length) ctx += "Son duyurular:\n" + ann.map(a => "- " + clip(a, 250)).join("\n") + "\n";
    const rs = u0 ? rows("resources").slice(-30) : []; if (rs.length) ctx += "Sistemdeki kaynaklar:\n" + rs.map(r => "- " + clip(strip(r), 160)).join("\n") + "\n";
    const sc = rows("schools").slice(0, 40); if (sc.length) ctx += "Okul listesi:\n" + sc.map(s => "- " + clip(s, 160)).join("\n") + "\n";

    const users = hist.filter(m => m.role === "user");
    const hits = search(rows("kb"), users.slice(-2).map(m => m.content).join(" "));
    if (hits.length) ctx += "\nOKUL BİLGİ BANKASI (ilgili kayıtlar):\n" + hits.map(e => `### ${clip(e.title, 120)}\n${clip(e.text, 1800)}`).join("\n\n") + "\n";

    // Web araması gibi sunucu araçları uzun sürerse "pause_turn" döner; kaldığı yerden devam ettir
    const msgs = hist.map(m => ({ ...m }));
    let text = "";
    for (let i = 0; i < 4; i++) {
      const { ok, status, j } = await call({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5", max_tokens: 2000,
        system: SYSTEM + "\n\nÖĞRENCİ VERİLERİ VE OKUL BİLGİSİ\n" + ctx,
        tools: process.env.WEB_SEARCH === "off" ? undefined : [{ type: "web_search_20250305", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "TR", timezone: "Europe/Istanbul" } }],
        messages: msgs,
      });
      if (!ok) throw err(502, "Yapay zeka hatası: " + ((j.error && j.error.message) || status));
      text += (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
      if (j.stop_reason !== "pause_turn") break;
      msgs.push({ role: "assistant", content: j.content });
    }
    text = text.trim() || "Şu an cevap üretemedim, lütfen tekrar dene.";
    if (u.role === "ogrenci" && users.length % 3 === 0) learn(u.tc, hist, text);
    return { text };
  };
};
