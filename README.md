# LGS Asistan: sunuculu sürüm

Bu sürümde veritabanı ve giriş sistemi sunucudadır. Öğrenci, veli ve öğretmenlerin claude.ai hesabına ihtiyacı yoktur. Tarayıcıdan adresi açıp TC kimlik no ve şifreyle girerler.

## İçindekiler
- `server.js`: sunucu (Node.js, ek paket gerekmez) ve SQLite veritabanı
- `public/index.html`: arayüz (tarayıcıda çalışır, sunucuya `/api` üzerinden bağlanır)
- `Dockerfile`: konteyner olarak yayınlamak için

## Program sekmesi (çalışma programı robotu)
Öğrenci "Program" sekmesinde sınıfını, günlük hedef soru sayısını, dinlenme gününü, çalışmak istediği konuları (konu tekrarı, soru çözümü, video ders; istenirse belirli bir gün) ve günlük rutinleri seçer. Robot haftalık programı üretir ve sisteme kaydeder. Öğrenci görevleri işaretler, yazdırır veya PDF olarak kaydeder, isterse yapay zeka koç yorumu alır. Rehber ve branş öğretmeni istediği öğrenci için program hazırlayabilir, veli bağlı olduğu öğrencinin programını yalnızca görüntüler. Konu listeleri örnektir, öğrenci özel konu ekleyebilir.

## Bilgisayarında deneme
1. Node.js 22.13 veya üstünü kur (önerilen: 24).
2. Klasörde `node server.js` çalıştır.
3. Tarayıcıda `http://localhost:3000` aç. İlk açılışta rehber öğretmen hesabını oluşturursun.
4. Rehber "Kullanıcılar" sekmesinden öğrenci, veli ve öğretmen hesapları ekler (şifre en az 6 karakter).

Yapay zeka özelliklerini (analiz, rehberlik sohbeti, optik okuma) açmak için `ANTHROPIC_API_KEY` ortam değişkenini tanımla. Anahtar yalnızca sunucuda durur, tarayıcıya gönderilmez.

## İnternette yayınlama
Bir yerde sürekli açık bir Node.js sunucusu gerekir. Üç yaygın yol:
- **Render, Railway veya Fly.io:** Klasörü bir Git deposuna yükle, "Web Service" oluştur, başlatma komutu `node server.js`. `DATA_DIR` için kalıcı disk (volume) bağla ve `ANTHROPIC_API_KEY` ekle. Kalıcı disk olmazsa her yeniden başlatmada veriler silinir.
- **Docker:** `docker build -t lgs-asistan .` ardından `docker run -p 3000:3000 -v lgsdata:/data -e ANTHROPIC_API_KEY=... lgs-asistan`
- **Kendi sunucun (VPS):** `node server.js` komutunu systemd veya pm2 ile çalıştır, önüne Caddy ya da Nginx koyup HTTPS ekle.

**HTTPS zorunludur.** Şifreler ve TC numaraları düz HTTP üzerinden gitmemelidir. Render, Railway ve Fly.io HTTPS'i kendisi sağlar.

## Yedekleme
Tüm veri `DATA_DIR` klasöründedir (`lgs.db` veritabanı, `files/` yüklenen dosyalar, `secret` anahtarı). Bu klasörü düzenli yedekle. `secret` kaybolursa herkes yeniden giriş yapar, hesaplar silinmez.

## Güvenlik özeti
- Şifreler scrypt ile özetlenip saklanır, özet ve tuz değerleri tarayıcıya hiç gönderilmez.
- Yetki kontrolü sunucudadır: öğrenci yalnızca kendi sonuçlarını ve mesajlarını görür, veli yalnızca bağlı olduğu öğrencinin sonuçlarını görür, görüşme notlarını yalnızca öğretmenler görür.
- Öğrencilere başka öğrencilerin sonuçları kimliksiz (sınıf ortalaması için) gönderilir. Öğretmen TC numaraları öğrencilere gizlenir.
- Girişte 15 dakikada en fazla 8 hatalı deneme; yapay zeka için kullanıcı başına saatte 60 istek sınırı vardır.

## Bilinen eksikler ve dikkat
- **KVKK:** Öğrenci verileri kişisel veridir. Yayına almadan önce okul yönetimi ve veli aydınlatma/onay süreçlerini tamamlayın, verilerin tutulacağı sunucunun yerini ve erişimini belgeleyin. Bu yazılım hukuki uygunluğu tek başına sağlamaz.
- Cevap anahtarı, deneme eklendiği anda öğrenciler tarafından görülebilir. Denemeyi sınavdan sonra ekleyin.
- Şifreyi unutan öğrenci için rehber "Kullanıcılar" sekmesinden yeni şifre belirler. E-posta ile sıfırlama yoktur.
- Oturum 12 saat geçerlidir. Sunucu tek makinede çalışacak şekilde tasarlanmıştır (SQLite); yüzlerce eş zamanlı kullanıcıdan sonrası için PostgreSQL gibi bir veritabanına geçilmelidir.
- Optik okuma yapay zekayla yapıldığı için hata yapabilir. Kaydetmeden önce okunan cevapları kontrol edin.
- Henüz yok: e-Okul/MEBBİS entegrasyonu, bildirimler, ödev teslim takibi, e-posta ile şifre sıfırlama.
