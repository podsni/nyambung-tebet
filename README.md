# Nyambung

Direktori kafe yang nyaman untuk kerja, dibuat untuk layar ponsel. Situs live: **https://nyambung-tebet.podsni0.workers.dev**.

## Yang tersedia

- Pencarian, filter fasilitas, pengurutan Wi-Fi/rating, detail tempat, dan tautan Maps.
- Foto pada kartu dan detail. Admin dapat menempel URL HTTPS langsung atau mengunggah JPEG/PNG/WebP; foto dioptimalkan di browser dan disimpan di R2. Tempat tanpa foto menampilkan placeholder yang jujur.
- Lokasi saat ini hanya diminta setelah tombol ditekan. Lokasi berada di memori tab, dapat dihapus, dan dipakai untuk jarak perkiraan serta arah perjalanan. Urutan terdekat memerlukan koordinat kafe yang sudah dilengkapi admin.
- Speedtest HTTP Cloudflare dengan warm-up, beberapa sampel, progres, pembatalan, dan dua mode pemakaian data. Angka mengukur koneksi perangkat saat tes, bukan menguji Wi-Fi kafe dari jauh.
- ISP/provider otomatis dari metadata jaringan publik/ASN bila tersedia. VPN/proxy dapat mengubah provider yang terlihat. Browser tidak dapat membaca nama Wi-Fi/SSID secara otomatis.
- Admin dengan sesi HttpOnly, rate limit login, validasi origin, CRUD, autofill Google Maps, koordinat, serta tes Wi-Fi yang mengisi formulir sebelum disimpan.
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

Untuk situs yang sudah memiliki data, gunakan riwayat migrasi yang benar. `0003_media_location_network.sql` hanya menambah kolom; tidak menghapus atau mengganti kafe lama. Jangan mengimpor ulang dump privat ke repository.

## Pengujian

```sh
npm run test:syntax
npm test
```

`npm test` membuat konfigurasi, credential acak, D1, dan R2 **lokal sementara**, menjalankan CRUD/foto/validasi serta skenario penghapusan, lalu membersihkan semuanya. Pengujian memiliki guard localhost dan tidak memakai konfigurasi maupun database produksi. Pengujian hapus semua hanya dijalankan pada salinan lokal yang dibuat khusus untuk tes.

## Keamanan dan data

`wrangler.jsonc`, `.dev.vars*`, `.env*`, direktori state, artifact, dan hasil build dikecualikan dari Git. Repository berisi contoh konfigurasi tanpa ID infrastruktur privat atau nilai secret. Dataset seed berisi 27 catatan awal publik tanpa password; data live yang ditambah melalui admin tidak disalin ke source.

Password Wi-Fi hanya tampil di API publik ketika admin memberikan persetujuan berbagi. Foto URL eksternal dapat bergantung pada host sumber; gunakan upload R2 untuk foto milik sendiri yang lebih stabil. Foto harus sesuai tempat dan boleh digunakan oleh pengunggah.
