# Nyambung

Direktori kafe yang nyaman untuk kerja, dibuat untuk layar ponsel. Situs live: **https://nyambung-tebet.podsni0.workers.dev**.

## Yang tersedia

- Pencarian, filter fasilitas, pengurutan berdasarkan pembaruan terbaru, Wi-Fi, rating Nyambung atau Google Maps, detail tempat, tautan Maps, serta tombol salin untuk password yang admin setujui untuk dibagikan. Waktu pembaruan terakhir per kafe dan tombol sinkronisasi membantu pengunjung memastikan mereka melihat data terbaru.
- Pencarian mencakup nama kafe, area, alamat, dan SSID yang sudah dibagikan publik, tanpa mengindeks password. Pencarian mengabaikan kapitalisasi, aksen, tanda baca, dan variasi spasi; kata dapat dibalik urutannya dan satu salah ketik ringan ditoleransi untuk kata minimal lima huruf. Mode Rekomendasi mengutamakan kecocokan paling dekat saat mencari. Jika filter menyembunyikan hasil, tombol pencarian semua area/fasilitas mempertahankan kata kunci.
- Permintaan daftar/detail yang gagal sementara dicoba ulang satu kali dengan batas waktu. Saat detail tetap gagal, modal menampilkan data dari daftar yang sudah dimuat dengan penanda yang jelas dan tombol coba lagi; password tidak direkayasa atau dianggap belum dibagikan hanya karena jaringan gagal.
- Foto pada kartu dan detail. Admin dapat menempel URL HTTPS langsung atau mengunggah JPEG/PNG/WebP; foto dioptimalkan di browser dan disimpan di R2. Tempat tanpa foto menampilkan placeholder yang jujur.
- Jika izin lokasi browser sudah pernah diberikan, lokasi perangkat dicari otomatis setelah daftar kafe dimuat; jika browser perlu meminta izin, permintaan baru dimulai setelah tombol ditekan. Header menampilkan area yang terdeteksi secara perkiraan, termasuk saat berada di luar Tebet. Bila GPS tidak tersedia, Tebet, Jakarta ditandai jelas sebagai fallback. Koordinat presisi tetap di memori tab; untuk nama area, hanya koordinat yang dibulatkan sekitar 100 m yang diteruskan melalui Worker ke Photon/OpenStreetMap. Nyambung tidak menyimpan titik GPS ke D1. Saat pengguna sendiri membuka petunjuk arah, titik asal diteruskan ke Google Maps. Jarak tetap garis lurus, bukan jarak rute, dan pengurutan terdekat memerlukan koordinat kafe.
- Speedtest HTTP Cloudflare dengan warm-up, beberapa sampel, progres, pembatalan, dan dua mode pemakaian data. Angka mengukur koneksi perangkat saat tes, bukan menguji Wi-Fi kafe dari jauh.
- ISP/provider otomatis dari metadata jaringan publik/ASN bila tersedia. VPN/proxy dapat mengubah provider yang terlihat. Browser tidak dapat membaca nama Wi-Fi/SSID secara otomatis.
- Admin dengan sesi HttpOnly, rate limit login, validasi origin, CRUD, dan impor otomatis dari tautan Google Maps. Nama, area, alamat lengkap, koordinat, rating Google, serta jumlah ulasan diisi bila terbaca, lalu tetap dapat ditinjau dan diedit sebelum disimpan. Jika tempat yang sama sudah terdaftar, data lama dibuka untuk diperbarui alih-alih membuat duplikat.
- Daftar kafe dapat diekspor sebagai CSV atau backup JSON versi 1. Pemulihan menampilkan tinjauan jumlah kafe yang akan diperbarui/ditambah, lalu menggabungkan data tanpa menghapus kafe yang tidak ada di backup. SSID, password Wi-Fi, dan rating pengguna tidak disertakan; kolom Wi-Fi privat dan foto kafe yang ada tetap dipertahankan saat update. Backup tidak menyalin berkas foto.
- Rating Google Maps ditampilkan terpisah dari rating pengguna Nyambung. Pengguna dapat memberi satu rating per browser dan memperbaruinya dari browser yang sama; backend hanya menyimpan identitas browser dalam bentuk hash.
- Tes Wi-Fi mengisi formulir sebelum disimpan; semua hasil ukur tetap bisa diperiksa dan diedit admin.
- Hapus satu, beberapa pilihan, atau seluruh **data kafe**. Penghapusan massal memerlukan dialog, daftar target, frasa konfirmasi persis, dan pemeriksaan ulang jumlah/ID di server. Backend tidak memakai `DELETE FROM cafes` tanpa kondisi ID.

## Teknologi

HTML, CSS, dan JavaScript tanpa framework frontend; Cloudflare Workers, D1, dan R2. Aset statis dikompresi lalu dibundel ke Worker oleh `build-assets.mjs`.

## Jalankan lokal

Memerlukan Node.js 20+.

```sh
npm ci
cp wrangler.example.jsonc wrangler.jsonc
# Isi ID D1 dan nama bucket milik Anda di wrangler.jsonc.
npm run build
npx wrangler d1 migrations apply DB --local
npm run dev
```

Buat `.dev.vars` lokal untuk `ADMIN_PASSWORD_HASH` dan `SESSION_SECRET` jika ingin masuk sebagai admin. Password tidak disimpan sebagai plaintext; format hash adalah PBKDF2-SHA256 dengan salt acak. Utilitas `scripts/hash-password.mjs` membaca password dari stdin. Jangan menaruh password pada argumen command atau source.

## Deploy ke akun Anda

Buat database D1 serta bucket R2, lalu isi konfigurasi privat `wrangler.jsonc`. Binding yang dibutuhkan:

| Binding | Jenis | Kegunaan |
| --- | --- | --- |
| `DB` | D1 | Data kafe dan pembatasan login |
| `CAFE_PHOTOS` | R2 | Berkas foto yang diunggah admin |
| `ADMIN_PASSWORD_HASH` | Secret | Hash password admin |
| `SESSION_SECRET` | Secret | Kunci HMAC acak, 32 byte base64url |

Set secret melalui input standar, bukan commit atau konfigurasi publik. Contoh Bash untuk hash admin:

```sh
read -r -s -p 'Password admin: ' ADMIN_PASS; printf '\n'
printf '%s' "$ADMIN_PASS" | node scripts/hash-password.mjs | npx wrangler secret put ADMIN_PASSWORD_HASH
unset ADMIN_PASS
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put SESSION_SECRET
npx wrangler d1 migrations apply DB --remote
npm run build
npx wrangler deploy
```

Untuk situs yang sudah memiliki data, gunakan riwayat migrasi yang benar. `0004_google_and_community_ratings.sql` menyalin nilai `rating` lama ke kolom rating Google, menambahkan agregat Nyambung, dan membuat tabel rating tanpa menghapus kafe lama. Jangan mengimpor ulang dump privat ke repository.

## Pengujian

```sh
npm run test:syntax
npm run test:search
npm run test:maps
npm test
npx playwright install chromium
npm run test:browser
```

`npm test` membuat konfigurasi, credential acak, D1, dan R2 **lokal sementara**, menjalankan CRUD, validasi, pemeriksaan pembulatan lokasi, impor foto, backup-restore berulang dan pelestarian rating/Wi-Fi privat, serta skenario penghapusan, lalu membersihkan semuanya. Pengujian memiliki guard localhost dan tidak memakai konfigurasi maupun database produksi. Pengujian hapus semua hanya dijalankan pada salinan lokal yang dibuat khusus untuk tes.

`test:browser` memakai server lokal dan data fixture, bukan API produksi. Tes memeriksa pencarian variasi Citrasena/critasena, filter Klojen, modal detail, retry otomatis, fallback saat permintaan sengaja digagalkan, pemulihan manual, serta layout 320–1365 px. Jika memakai Chromium sistem, jalankan `CHROMIUM_PATH=/path/to/chromium npm run test:browser`.

## Keamanan dan data

`wrangler.jsonc`, `.dev.vars*`, `.env*`, direktori state, artifact, dan hasil build dikecualikan dari Git. Repository berisi contoh konfigurasi tanpa ID infrastruktur privat atau nilai secret. Dataset seed berisi 27 catatan awal publik tanpa password; data live yang ditambah melalui admin tidak disalin ke source.

Password Wi-Fi hanya tampil di API publik ketika admin memberikan persetujuan berbagi. Impor Google Maps bersifat upaya terbaik; tautan tertentu mungkin tidak menyediakan rating atau jumlah ulasan, dan fitur tidak mengisi nilai yang tidak terbaca. Foto URL eksternal dapat bergantung pada host sumber; gunakan upload R2 untuk foto milik sendiri yang lebih stabil. Foto harus sesuai tempat dan boleh digunakan oleh pengunggah.
