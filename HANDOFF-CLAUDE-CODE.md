# Handoff — Nuvio Web (branch `experiment/movi-engine`)

Ditulis: sesi 2026-10-22, setelah satu sesi panjang yang berakhir dengan satu bug terbuka
(crash setelah pemutar muncul). Dokumen ini dibuat agar pekerjaan bisa dilanjutkan tanpa
mengulang diagnosis yang sudah dilakukan.

---

## 1. Aturan kerja yang WAJIB dipatuhi

| Aturan                                                                          | Keterangan                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jangan merge ke branch `web`                                                    | branch ini eksperimen                                                                                                                                                                                                             |
| `js/ui/screens/player/playerScreen.js` dan `js/core/player/playerController.js` | awalnya dilarang disentuh; izin pernah diberikan **hanya** untuk: gerbang tunggu sebelum `video.src`, teks splash, dan `selectDirectPlayableCandidates` (autoplay episode berikutnya). Jangan menambah perubahan lain tanpa izin. |
| Verifikasi wajib                                                                | `npm.cmd test` (Windows: pakai `.cmd`) dan `npm.cmd run build`                                                                                                                                                                    |
| Restart server setelah mengubah bridge                                          | `node scripts/serve.mjs`                                                                                                                                                                                                          |
| Kalau perilaku HP ≠ kode                                                        | curigai **service worker basi** lebih dulu; hapus-pasang PWA lalu cek tanggal `build:` di `/app.bundle.js`                                                                                                                        |
| Pre-commit hook                                                                 | husky menjalankan prettier; file yang belum diformat akan menolak commit                                                                                                                                                          |

Repo: `C:\Projects\NuvioWeb-movi` · branch: `experiment/movi-engine` · HEAD: `cd663ab3`
Suite: **1280 lulus, 0 gagal** · working tree bersih.

---

## 2. Arsitektur singkat

SPA statis di `dist/`, disajikan `scripts/serve.mjs` (port 4173) dan diakses lewat tunnel
`https://movi.alphasquare.my.id`.

Tiga bridge, masing-masing bisa dimatikan lewat env:

| Bridge    | Fungsi                                            | Endpoint                                   | Status di mesin dev |
| --------- | ------------------------------------------------- | ------------------------------------------ | ------------------- |
| probe     | `ffprobe` membaca codec/tag/kanal dari URL sumber | `/api/probe`                               | **aktif**           |
| remux     | `ffmpeg -c copy` → fMP4 HLS                       | `/api/transcode/hls/...` (dipakai bersama) | **mati**            |
| transcode | encode audio (dan opsi video) → HLS               | sama                                       | **mati**            |

Relay memakai satu bridge transcode untuk dua mode: `a=copy` (remux) dan `a=aac`
(transcode audio). Parameter `ai=<0..7>` memilih track audio (`-map 0:a:<i>`) — terverifikasi
bekerja: sumber E-AC-3 5.1 + AAC 2.0, dengan `ai=1` output menjadi `aac, 2 kanal` **tanpa
encoding**.

---

## 3. Fakta terukur (jangan diragukan lagi)

| Fakta                                                         | Bukti                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **AAC 5.1 BISA diputar iPhone**                               | dua berkas uji (`only-51-aac.mp4`, `only-20-aac.mp4`) keduanya bersuara di perangkat                                |
| Aturan "Apple hanya stereo" **salah**                         | karena itu `requiresStereoAac`/downmix berbasis kanal dicabut                                                       |
| Senyap pada berkas nyata berasal dari **codec track pertama** | probe: `eac3 6ch` di track 0, `aac 2ch` di track 1; relay `a=copy` menyajikan `eac3/ec-3` dan pemutar membisukannya |
| `hev1` ditolak iPhone, `hvc1` diterima                        | terbukti dari mediaError + A/B retag                                                                                |
| MPEG-4 Part 2 (`mpeg4`/`mp4v`) tidak bisa diputar di mana pun | probe stream nyata; sekarang selalu `Transcode`                                                                     |
| Probenya makan waktu **2,5–9 detik**                          | log server: `3359ms … 8807ms`                                                                                       |
| Klien dulu abort di **3 detik**                               | itulah sebab label `Unknown` massal; sekarang 15 detik (bridge 20 detik)                                            |
| CDN debrid menolak user-agent ffprobe default                 | ditambah `-user_agent` browser                                                                                      |
| Badai retry pernah terjadi                                    | 507 request, **0** sampai ke ffprobe, `negativeSize 1` → satu URL diulang terus                                     |
| Teks addon tidak bisa dipercaya                               | `8bit` pernah dibaca h264; `AAC5.1` ternyata E-AC-3                                                                 |

---

## 4. Perilaku label yang berlaku sekarang

Urutannya (di `js/ui/components/streamPlaybackBadge.js`):

1. **`Unsupported`** — kontainer mkv/ts/avi **dan** deployment tanpa relay. Tidak perlu probe.
2. **`Checking…`** — belum ada jawaban probe dan probe aktif.
3. Hasil probe: `Direct` / `Remux` / `Transcode …` / `Remux (unavailable)` / `Transcode (unavailable)`.
4. **`Unknown`** — probe gagal/kosong (URL masih boleh dicoba lagi setelah cooldown).

Teks addon **tidak** dipakai untuk melabeli. Ia hanya dipakai untuk **mengecualikan** baris
yang mustahil (mkv tanpa relay).

---

## 5. Alur auto-play (peta lengkap)

```
tap judul
  └─ metaDetailsScreen.openStreamRoute(params, options)        (baris ~3284)
       ├─ auto-play mati / manualSelection → Router.navigate("stream")
       └─ auto-play aktif:
            ├─ tampilkan "Finding a stream…" (renderRouteHandoff)
            ├─ resolveAutoPlayStream()            js/core/streams/streamAutoResolve.js:110
            │     └─ memilih dari TEKS (selectAutoPlayStream), bukan dari probe
            ├─ keepOnlyDirectResolution()         metaDetailsScreen.js (~3360)
            │     ├─ resolve debrid ≤5 kandidat (DirectDebridStreamPreparer.prepare)
            │     ├─ probe tiap kandidat (timeout 12 detik)
            │     └─ selected = kandidat pertama ber-verdict "direct" | null
            └─ Router.navigate("stream", { autoResolvedStreams, autoResolvedStreamId })
                 └─ streamScreen.adoptAutoResolvedStreams()   (baris ~930)
                      ├─ ada id → playStream(id) langsung
                      └─ tidak ada → daftar stream terbuka, lalu memprobe sendiri
```

Auto-play di halaman stream: `maybeAutoPlayStream()` (~1448) dengan gate berurutan:
`autoResumeUiActive/autoPlayAttempted/autoPlayCountdown` → `streams.length` →
`manualSelection` → `autoPlaySelectionReady` → mode → **penantian probe** → `selectAutoPlayStream`
→ kalau kosong dan `probesSettled()` baru tandai `autoPlayAttempted`.

### Pemilihan stream (`js/core/streams/streamAutoPlaySelector.js:163`)

- saring per source (`ALL_SOURCES` / `INSTALLED_ADDONS_ONLY` / `ENABLED_PLUGINS_ONLY`)
- saring per addon/plugin terpilih di setting auto-play
- binge group diutamakan bila diingat
- mode `MANUAL` → **null**; `FIRST_STREAM` → baris pertama yang "playable"; `REGEX_MATCH` → cocok regex
- "playable" = hanya melihat `url`/`infoHash`/`magnetUri`/`debridCacheStatus` — **tidak** melihat codec

### Siapa yang boleh berkata "tidak ada stream"

1. `resolveAutoPlayStream` → `reason: "no-match" | "disabled" | "no-target" | "error"`
2. `keepOnlyDirectResolution` → `selected = null`
3. `getFilteredStreams` di halaman stream → daftar kosong
4. `maybeAutoPlayStream` → `selectAutoPlayStream` null

---

## 6. Bug yang masih terbuka (prioritas)

### 6.1 CRASH setelah layar pemutar muncul — **belum ditemukan**

Gejala (dari HP, build `14:02:05`): dengan `Only show Direct` + auto selection, layar pemutar
sempat terlihat sekejap lalu aplikasi crash (background + navbar mati).

Yang sudah dicoba:

- Server **tidak menerima** `[client-error]` (endpoint `/api/debug/log` ada dan berfungsi).
- Reproduksi di Chrome desktop belum berhasil karena **klik pada kartu tidak bereaksi** lewat
  `element.click()`; aplikasi tampaknya memakai `pointerdown`/touch.

Dugaan utama (belum diverifikasi):

- `autoResolvedStreamId` menunjuk baris yang tidak ada di `autoResolvedStreams` setelah
  penyaringan, sehingga pemutar membaca properti dari `undefined`.
- `keepOnlyDirectResolution` mengembalikan objek `{...resolution, streams, selected, directStreams}`
  dan ada pemakai yang tidak mengharapkan bentuk itu.

Langkah yang disarankan: di Chrome, kirim klik memakai CDP
`Input.dispatchTouchEvent` atau urutan `mouseMoved → mousePressed → mouseReleased`, tekan
kartu Continue Watching, lalu baca `Runtime.exceptionThrown`.

### 6.2 `probesSettled()` tidak akan pernah true (kontradiksi desain)

`probesSettled()` (streamScreen ~1439) menuntut **semua** baris punya jawaban/gagal.
Tetapi `selectRowsToProbe` (`js/core/player/streamProbe.js:57`) hanya mengambil ≤5 baris kelas
`tag` + ≤2 `unknown`, dan **melewati** baris yang teksnya sudah Direct/Remux.

Akibatnya: baris yang tidak pernah diprobe membuat `probesSettled()` selamanya false →
auto-play menunggu sampai batas waktu → menyerah.

### 6.3 Filter Direct hanya bisa dipenuhi baris yang diprobe

`getFilteredStreams` (~1632) menuntut `_probeResults` ada. Karena subset di 6.2, baris di luar
subset **tidak akan pernah tampil** saat filter aktif. Inilah sumber "daftar kosong".

Perbaikan yang disarankan (pilih satu):

- **A** saat filter Direct aktif, probe **semua** kandidat sampai `PROBE_PAGE_LIMIT` (abaikan
  pembatasan kelas tag/unknown);
- **B** wariskan hasil probe dari layar loading ke halaman stream (`autoResolvedProbes`) agar
  tidak diprobe dua kali;
- **C** tampilkan baris tanpa jawaban sebagai `Checking…` dan jadikan "Only show Direct"
  sebagai aturan **pemilihan otomatis**, bukan penyaring tampilan.

### 6.4 Probe ganda

Hasil probe di `keepOnlyDirectResolution` tidak dibawa ke halaman stream; halaman stream
memprobe ulang. Boros, dan membuat keputusan tidak konsisten (lihat 6.2/6.3).

### 6.5 MKV tidak bisa diputar (bukan bug kode)

Di mesin ini relay **mati** (`REMUX_ENABLED=false`), jadi semua MKV `Unsupported`. Ini pilihan
pemilik karena disk hanya sisa 4 GB.

### 6.6 i18n

Banyak string baru hanya Inggris (`res/values/strings.xml`); terjemahan locale lain belum
diisi. Kunci yang hilang akan memakai fallback bahasa Inggris.

---

## 7. Peta berkas penting

| Berkas                                      | Isi                                                                                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/probe-bridge/bridge.mjs`          | ffprobe + cache identitas, TTL, negative cache, rate limit, concurrency, daily byte budget, `audioStreams`, `videoTag`, `-user_agent`                                                           |
| `services/transcode-bridge/bridge.mjs`      | HLS fMP4; `ai=<index>` memilih track audio; HLS idle kill; egress/disk budget                                                                                                                   |
| `services/remux-bridge/bridge.mjs`          | remux buffered + HLS; quota; abandon grace                                                                                                                                                      |
| `scripts/serve.mjs`                         | static + bridge + `/nuvio.env.js` + `/api/debug/log` + guard path privat                                                                                                                        |
| `scripts/envProperties.mjs`                 | `ENV_PROPERTY_KEYS` (termasuk `PROBE_PAGE_LIMIT`), `FEATURE_SWITCHES/DEFAULTS`                                                                                                                  |
| `js/core/player/playbackMethod.js`          | `classifyPlayback` (video tidak dikenal → UNKNOWN; mpeg4 tidak didukung; keputusan audio berbasis codec)                                                                                        |
| `js/core/player/streamProbe.js`             | `selectRowsToProbe`, `createStreamProber`, `isTagCriticalVerdict`                                                                                                                               |
| `js/core/player/transcodeSource.js`         | tanda tangan plan (termasuk `ai`)                                                                                                                                                               |
| `js/ui/components/streamPlaybackBadge.js`   | semua label + warna                                                                                                                                                                             |
| `js/ui/screens/stream/streamScreen.js`      | pipeline probe (cooldown, attempt cap), `getFilteredStreams`, `maybeAutoPlayStream`, `probesSettled`, badge + settings label, `remuxPlaylistUrl(url, {audioIndex})`, `adoptAutoResolvedStreams` |
| `js/ui/screens/detail/metaDetailsScreen.js` | `openStreamRoute`, `keepOnlyDirectResolution`, layar handoff                                                                                                                                    |
| `js/ui/screens/player/playerScreen.js`      | `selectDirectPlayableCandidates` (episode berikutnya), teks splash, gerbang tunggu                                                                                                              |
| `js/data/local/streamBadgeSettingsStore.js` | `showPlaybackLabels`, `labelAddons` (+ normalizer yang dulu membuangnya)                                                                                                                        |
| `res/values/strings.xml`                    | string baru                                                                                                                                                                                     |

---

## 8. Cara menjalankan (Windows + PowerShell)

```powershell
cd C:\Projects\NuvioWeb-movi

# server dev: probe saja
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*serve.mjs*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$env:FFMPEG_PATH='C:\Program Files\Jellyfin\Server\ffmpeg.exe'
$env:FFPROBE_PATH='C:\Program Files\Jellyfin\Server\ffprobe.exe'
$env:PROBE_ENABLED='true'; $env:REMUX_ENABLED='false'; $env:TRANSCODE_ENABLED='false'
$env:PROBE_PAGE_LIMIT='20'
$env:PROBE_TTL_MS='86400000'
$env:PROBE_DAILY_BYTES='42949672960'
$env:PROBE_MAX_CONCURRENT='8'
$env:PROBE_RATE_LIMIT_PER_MINUTE='120'
node scripts/serve.mjs
```

Cek cepat:

```bash
curl -s http://127.0.0.1:4173/api/probe/health
curl -s http://127.0.0.1:4173/nuvio.env.js
```

---

## 9. Alat uji yang sudah disiapkan

### Chrome debug (non-headless)

```powershell
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222","--user-data-dir=C:\Projects\_spike-movi\chrome-profile","https://movi.alphasquare.my.id"
```

Harness: `C:\Projects\_spike-movi\cdp2.mjs`

```
node cdp2.mjs ua            # pasang UA iPhone + reload
node cdp2.mjs text          # isi layar
node cdp2.mjs shot out.png  # screenshot
node cdp2.mjs click "teks"  # klik berbasis teks (sering meleset)
node cdp2.mjs tap 190 800   # klik koordinat (masih perlu touch/pointer event)
node cdp2.mjs eval "<js>"   # jalankan JS di halaman
node cdp2.mjs logs 3        # 3 detik terakhir console
```

### Fixtures

`C:\Projects\_spike-movi\transcode-fixtures`

- `only-51-aac.mp4` — HEVC hvc1 + AAC 6 kanal (terbukti bersuara di iPhone)
- `only-20-aac.mp4` — HEVC hvc1 + AAC 2 kanal
- `dual-audio-51-first.mp4` — 5.1 (default) + stereo
  Disajikan `http://192.168.2.2:8126/<nama>`

### Log klien ke server

`POST /api/debug/log` (dipasang di `scripts/serve.mjs`, dipanggil dari hook di `js/app.js`).
Berguna saat HP crash dan console tidak bisa dibuka.

---

## 10. Langkah berikutnya (urutan yang disarankan)

1. **Reproduksi crash 6.1** di Chrome dengan touch event; baca exception; perbaiki penyebabnya.
2. **Selesaikan 6.2 + 6.3** (pilih A/B/C). Tanpa ini, "Only show Direct" dan auto-play tidak
   akan pernah konsisten.
3. **Uji end-to-end di HP**: hapus-pasang PWA → buka film → label → putar.
4. Baru setelah itu: pertimbangkan menyalakan remux dengan pengaman disk 3 GB
   (`REMUX_MAX_CONCURRENT=1`, `REMUX_MAX_DISK_BYTES=3221225472`, TTL pendek) supaya MKV bisa
   diputar.
5. i18n untuk string baru.

---

## 11. Jebakan yang sudah memakan waktu (jangan diulang)

- **Menebak tanpa membaca log.** Sesi ini tiga kali salah diagnosis (filter → badai retry →
  user-agent) sebelum akhirnya log server menunjukkan durasi probe 3–9 detik vs batas klien 3 detik.
  Selalu ambil bukti dari `/api/probe/health` dan log bridge dulu.
- **PowerShell**: `npm`/`npx` harus `.cmd`; string multi-baris harus dinormalisasi
  (`-replace "`r`n","`n"`) sebelum `Replace`; `Select-String` dengan kutip ganda mudah rusak.
- **Prettier** menolak commit jika file belum diformat (husky).
- **Service worker** menyajikan bundle lama; selalu cek tanggal build di `/app.bundle.js`.
- **Menambah field ke store tanpa menambahkannya ke normalizer** = nilai hilang saat dibaca
  (ini yang membuat pilihan addon selalu kembali ke "All addons").
- **Nama ikon yang tidak ada** di `ROW_ICONS` membuat seluruh seksi Settings blank (sudah
  diperbaiki dengan fallback chevron).
- **Membaca `.length` dari field opsional** pada profil lama = crash (sudah diberi guard).

---

## 12. Keputusan pemilik yang mengikat

| Keputusan                                                   | Nilai                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Anggaran bandwidth                                          | 2000 GB/bulan, **dihitung dua arah** (masuk + keluar)             |
| Disk                                                        | sisa **4 GB**                                                     |
| Relay                                                       | **dimatikan** di server pemilik (remux & transcode)               |
| `Only show Direct`                                          | hanya baris yang sudah diprobe dan `direct` yang ditampilkan      |
| Jangan tampilkan baris `Checking…` saat filter Direct aktif | dipilih pemilik                                                   |
| Label                                                       | hanya dari probe; teks tidak boleh melabeli                       |
| `PROBE_PAGE_LIMIT`                                          | dapat diatur per deployment; `0` = tanpa batas                    |
| Rate limit probe                                            | default 120/menit; `0` = tanpa batas (disarankan untuk self-host) |
| Autoplay tanpa kandidat Direct                              | buka daftar stream (seperti autoplay mati)                        |
| Pemilihan addon untuk label                                 | memakai daftar addon terpasang (bukan mengetik nama)              |

## 13. Kelanjutan Codex — 2026-10-23

Bukti baru dari Chrome pada profil utama, bukan dugaan penyebab reload HP:

- Sebelum perbaikan, filter Direct menampilkan sumber Direct tetapi autoplay mencatat
  `gave up waiting for probes`. Memilih sumber secara manual berhasil memutar video.
- Antrean halaman sekarang memprobe semua kandidat yang memenuhi syarat sampai batas
  deployment, termasuk sumber yang teksnya sudah tampak Direct. Batas berlaku lintas
  pass; 0 tetap tanpa batas. Penantian autoplay memakai kandidat yang sama.
- Bukti probe dan URL hasil resolusi diteruskan dari Detail ke Stream sebelum pemilihan.
  Hasil async dari screen yang sudah ditinggalkan diabaikan lewat loadToken.
- Saat deadline tercapai, autoplay masih memilih hasil Direct yang sudah tersedia.
- Bug terpisah berhasil direproduksi: setelah autoplay lalu Back dari Stream ke Detail,
  halaman Detail yang dipertahankan masih memiliki routeHandoffPending. Akibatnya layar
  Finding a stream menutupi halaman dan navbar. onRouteRevealed sekarang melepas handoff.
- Uji regresi Back gagal sebelum perbaikan dan lulus sesudahnya. Seluruh suite:
  1286 lulus, 0 gagal. Build sukses: 60ca5cb303b8.
- Verifikasi runtime pada build itu: Spider-Man: Brand New Day diputar otomatis,
  readyState=4, paused=false, mediaError=null. Back player -> Stream -> Detail berhasil,
  lalu navbar berhasil membuka Settings. Tidak ada Runtime.exceptionThrown atau navigasi
  dokumen/reload selama alur yang direkam.
- Pengaturan profil utama sesuai instruksi pemilik: FIRST_STREAM, Internal player,
  Built-in player. Filter Direct aktif selama uji.

Reload yang dilaporkan pemilik di HP **belum direproduksi**. Jangan menyebut service worker,
codec, atau error JavaScript tertentu sebagai penyebabnya tanpa rekaman yang mendukung.
Kode reload service worker tidak diubah. Relay tetap mati. Belum commit atau merge.

## 14. Perbaikan scope probe autoplay — 2026-10-23

Penyebab fallback kosong sudah dibuktikan melalui breakpoint Chrome: seleksi awal memilih
AIOStreams, tetapi keepOnlyDirectResolution mengambil 20 baris pertama daftar gabungan,
semuanya Torrentio. AIOStreams pertama berada di posisi 97 dan sama sekali tidak diprobe.
PROBE_PAGE_LIMIT=0 juga salah dianggap 20 pada tahap tersebut.

Perbaikan: filterAutoPlaySourceStreams dipakai bersama oleh selector dan pemeriksaan
Direct, sehingga source scope serta allowed addons/plugins diterapkan sebelum batas
kandidat, resolve debrid, dan probe. Nilai 0 sekarang tanpa batas. Batch hanya berhenti
ketika selector benar-benar menemukan pilihan yang memenuhi aturan (termasuk regex).
Daftar lengkap tetap dibawa untuk fallback manual; aturan label tidak diubah.

Bukti pada build 2694697f7e2f: 118 sumber total, 22 kandidat eligible semuanya AIOStreams,
6 diminta, 6 terjawab, 5 Direct. Pilihan AIOStreams sudah ada pada tahap Finding stream,
lalu player terbuka dan berjalan dengan readyState=4, paused=false, mediaError=null.

Verifikasi: 1293 test lulus, 0 gagal; lint pada berkas perbaikan bersih; build sukses.
Tujuh uji regresi baru mencakup addon yang mendahului AIOStreams, batas 0/positif,
addon dikecualikan, scope plugin, regex lintas batch, dan bukti probe/URL hasil resolve.
Perubahan tetap pada experiment/movi-engine, belum commit atau merge.

## 15. First stream memprobe satu per satu — 2026-10-23

Sesuai permintaan pemilik, mode FIRST_STREAM sekarang memakai satu kandidat per batch,
berurutan dari sumber teratas di addon autoplay yang diizinkan. Kandidat berikutnya
baru diprobe setelah kandidat sebelumnya selesai. Probe berhenti pada pilihan Direct
pertama yang memenuhi aturan. Mode regex tetap memakai batch sebelumnya.

Dua uji regresi tambahan membuktikan: bila kandidat pertama Direct, hanya satu URL
diprobe; bila tiga kandidat awal membutuhkan relay, urutan probe tepat empat URL dan
berhenti pada kandidat keempat. Seluruh suite: 1295 lulus, 0 gagal; lint berkas perubahan bersih.

## 16. Toggle label kartu stream — 2026-10-23

Handler streams:toggle:playbackLabels memanggil setShowPlaybackLabels yang belum
didefinisikan di StreamBadgeSettingsStore, sehingga klik melempar TypeError.
Setter ditambahkan mengikuti pola setter store yang lain. Uji regresi menjalankan
handler Settings sebenarnya dan memastikan off/on bertahan di snapshot dan storage,
pilihan addon/logo/ukuran tetap sama, serta profil lain tidak berubah.

1296 test lulus, 0 gagal; lint berkas perubahan bersih; build fde9c0f11c15 sukses.

## 17. Pisahkan cakupan label dari visibilitas sumber — 2026-10-23

Pilihan labelAddons sebelumnya selalu menyaring getFilteredStreams, sehingga addon
lain hilang meskipun Only Direct mati, termasuk saat toggle label juga mati.

Sekarang scope addon label hanya menyaring daftar saat Only Direct aktif. Saat mati,
semua sumber tetap tersedia sesuai filter Source halaman; label hanya digambar pada
addon yang dipilih. Antrean resolve/probe halaman Stream menerapkan scope addon label
sebelum batas PROBE_PAGE_LIMIT. Cache daftar juga menyertakan Only Direct dan labelAddons
agar perubahan pengaturan tidak memakai hasil lama. Pipeline Finding stream tetap
menggunakan scope addon autoplay tersendiri.

Tiga uji regresi mencakup visibilitas semua addon saat Only Direct mati (label on/off),
filter Direct dari scope label dan perubahan cache, serta penerapan scope sebelum
anggaran probe. Seluruh suite: 1299 lulus, 0 gagal. Build 6f41458b542a sukses.

## 18. Proses latar Windows tanpa jendela — 2026-10-23

Sesudah pengosongan cache lewat restart server latar, pemilik melihat jendela ffprobe
serta node.exe. Ditemukan dua spawn anak tanpa windowsHide: proses ffprobe pada probe
bridge dan helper services/webos/runtime/media-http.cjs pada server dev.
Keduanya sekarang memakai windowsHide: true. Server dan helper lama direstart tepat
sasaran; server baru sehat, runtime configuration dan kebijakan probe terverifikasi sama.
1299 test lulus dan build 0f078db8d807 sukses.

## 19. Satu deadline untuk Finding stream (2026-10-23)

- Stream Selection Timeout membatasi percobaan sejak Detail mulai Finding stream: pengambilan addon, persiapan link, dan probe berbagi `deadlineAt`.
- Hasil addon yang cocok dapat diperiksa tanpa menunggu addon lain yang lambat. FIRST_STREAM memprobe urutan atas dan berhenti pada Direct pertama.
- Tiap probe memakai minimum 15 detik atau sisa deadline. Hasil persiapan/probe terlambat tidak mengubah percobaan selesai.
- Jika tidak ada pilihan, `autoSelectionFinished` mencegah autoplay/resume lagi setelah daftar tampil; labeling tetap berjalan. Daftar memuat sumber lengkap bila prefetched masih parsial. Timeout menampilkan pesan Inggris/Indonesia.
- 0 detik tidak memulai pencarian baru; Unlimited tanpa deadline keseluruhan. Timeout jaringan per request tetap berlaku.
- Verifikasi: 1306 tes lulus, 0 gagal; build `95b47f892ab7`, terkonfirmasi dimuat Chrome. Cache probe direset setelah verifikasi untuk mencoba Project Hail Mary dari awal.

## 20. Overlay terpadu untuk internal player (2026-10-23)

- Pengguna menyetujui penggabungan Finding stream, Opening player, dan loading player. Izin ini mencakup perubahan tampilan loading terbatas pada playerScreen.js; controller tidak disentuh.
- StartupLoadingOverlay memiliki satu node fixed di body; Detail -> Stream -> Player hanya mengubah status. Settings Loading Overlay berlaku dari pencarian hingga frame pertama; Show loading status sekarang benar-benar menyembunyikan/menampilkan teks, termasuk teks relay.
- Status mengikuti pekerjaan nyata: finding/checking/opening, loadstart -> loading, progress tanpa metadata -> metadata, loadedmetadata/loadeddata/canplay -> frame atau restoring. Tahap yang sangat singkat dapat dilewati.
- Back, timeout/tidak ada pilihan, Manual, error startup, dan cleanup menutup overlay. External player/iframe dan engine Movi mempertahankan alur sebelumnya.
- Chrome profil utama semula Manual. Uji sementara First Stream membuktikan node yang sama dipakai dari finding sampai frame, lalu hilang; video readyState 4, paused false, error null. Mode uji dikembalikan Manual setelah pemeriksaan.
- Verifikasi: 1311 tes lulus, 0 gagal. Tambahan tes menutup kesinambungan node, toggle status, guard external/Movi, event video nyata, dan fallback Manual.

Validasi akhir overlay: build 521ff82bba7c; 1311 tes lulus. CSS lama dipertahankan, hanya 21 baris aturan overlay ditambahkan. Chrome: satu node bertahan melalui finding/checking/opening/loading/restoring/frame, lalu dihapus; video readyState 4 dan error null. Mode profil telah diverifikasi kembali Manual, simulasi latensi jaringan dimatikan.

## 21. Back autoplay dari Detail (2026-10-23)

- Pengguna melaporkan Player -> Detail -> Back membuka Player lagi. Pengguna memberi izin eksplisit mengubah playerScreen.js untuk perbaikan Back.
- Penyebab: Stream perantara masih masuk history walau autoplay melewati daftar; Back sintetis mengganti entri Player dengan Detail, dan popstate Back dapat dikonsumsi ulang. FocusEngine juga menekan popstate bila handler mengembalikan true meskipun telah meminta history Back.
- Stream mengganti entri perantara ketika returnRoute detail/home; pilihan manual tetap menyimpan entri Stream. Player mencoba history Back ke parent detail/home yang terbukti dari provenance, dan mengembalikan kontrak "history" agar FocusEngine tidak menelan popstate. Router menyelesaikan Back yang sudah diminta tanpa memanggil consumeBackRequest lagi pada event yang cocok.
- Patch tambahan FocusEngine telah dibatalkan; player memakai kontrak yang sudah ada. Controller tidak diubah.
- Verifikasi: 1317 tes lulus, 0 gagal; build 918d010b2930. Chrome profil utama, Project Hail Mary melalui tombol judul Detail -> Resume autoplay: Player history index2/previous detail -> Escape Detail index1 -> tombol Back Detail Home index0; tanpa error console. Pengaturan tidak diubah selama verifikasi Back.

## 22. Logo overlay bocor antarjudul / hanya teks (2026-10-23)

- Screenshot pengguna: latar Moana menampilkan logo Obsession. renderRouteHandoff memakai this.meta sebelum metadata route baru selesai, sementara helper overlay hanya mengisi artwork saat node pertama dibuat.
- Detail sekarang menandai params pemilik metadata pada load/restore dan hanya memakai meta yang cocok. Item key diteruskan Detail/Stream/Router/Player.
- Overlay memperbarui title/subtitle/backdrop/logo pada node yang sama; metadata item lain ditolak. Logo ditampilkan setelah onload berhasil; onerror tetap menampilkan judul yang benar. Callback gambar milik overlay lama diabaikan. Pembaruan metadata tidak memundurkan tahap Checking ke Finding.
- Verifikasi: 1320 tes lulus, 0 gagal; build ee7a101882ac. Tes khusus mencakup stale meta, logo terlambat, error gambar, dan callback judul lama.
- Chrome profil utama saat uji memakai Manual (pengaturan tidak diubah): Obsession Detail -> Home -> Moana manual -> pilih Direct. Semua jejak overlay bertitle Moana, tidak memakai logo Obsession; screenshot moana-overlay-logo-fixed.png menunjukkan logo dan latar Moana yang sesuai. Simulasi latensi sementara dikembalikan nol.

## 23. Dasar label kompatibilitas perangkat — 2026-10-23

Pengguna menyetujui perbaikan hasil audit label, dengan pengecualian eksplisit:
label merah tetap diagnostik full transcode; jangan membangun alur konversi video penuh.
Urutan berikutnya: audit player mobile/PWA, sorting kemampuan perangkat, eksperimen WASM.
Filter/sorting Connected Services dan sinkronisasinya belum diubah.

- Codec yang tidak diketahui/kemampuan API yang tidak tersedia kini Unknown, bukan otomatis didukung. HLS/DASH tetap Unknown sampai varian manifest diperiksa.
- Probe membawa codec string dari konfigurasi AVC/HEVC/AV1, profile/level, pixel format/bit depth, resolusi/FPS/bitrate, color transfer/primaries dan metadata audio. Attached-picture tidak dipilih sebagai video utama. Client mempertahankan fakta tersebut.
- Penilaian per file dilakukan lokal, di luar cache fakta server: native canPlayType + MediaCapabilities bila konfigurasi lengkap, WebCodecs untuk video Movi. AAC profile, DTS profile, channel dan sample rate ikut diperiksa. Nilai supported/smooth/powerEfficient adalah prediksi, bukan hasil playback.
- HDR dan jalur audio/container Movi belum terbukti oleh pemeriksaan SDR/video saja; keduanya tetap Unknown. FFprobe format_name gabungan matroska,webm belum membedakan DocType; hanya jawaban format webm yang tidak ambigu dipertahankan sebagai WebM. Perlu pekerjaan lanjutan bila ingin biaya minimum remux yang tepat untuk setiap WebM.
- Audio pertama yang didukung dipertahankan. Track pengganti harus didukung perangkat. Audio index diteruskan ke fallback remux, status/preparation dan cache; ffmpeg memetakan track yang sama.
- Nama file addon tidak lagi menolak probe atau langsung menghasilkan Unsupported sebelum fakta file ada.
- Availability remux/audio diperiksa lewat health dan kebijakan akses; belum diperiksa disebut unverified. Admission URL, codec output aktual dan akses LAN tetap ditentukan request sebenarnya. Label merah tidak diubah menjadi unavailable.
- Server eksperimen port4173 direstart hidden; probe aktif, remux/transcode tetap mati. Kebijakan terverifikasi tetap ttl86400000, maxEntries5000, maxConcurrent8, rateLimit0, dailyByteBudget0. Cache probe sebelumnya ikut kosong. Helper media tetap tersedia di2710.
- Verifikasi: 1346 tes lulus, build61268d06f38a. ffprobe asli pada video uji H264/AAC lokal berhasil menghasilkan codecString avc1.64000a, profile High, 160x90/24fps, audio LC stereo48kHz. Fixture dihapus. Lint file helper baru/lapisan probe/badge lulus; file lama masih memiliki lint praeksisting (escape regex, helper/import tidak digunakan).
- Smoke Chrome: build46d976c09828 (build antara) terkonfirmasi lewat URL log. Profil utama, addon AIOStreams/Torrentio enabled, tanpa mengubah setting. Project Hail Mary menampilkan No sources found; Spider-Man tertahan Checking streams. Statistik backend tetap requests0 saat diamati; ini belum membuktikan kegagalan classifier dan sebabnya belum dipastikan. Percobaan dibatalkan dengan Escape, kembali Home. Verifikasi label/pemutaran dari sumber nyata dan perangkat iOS/Android masih diperlukan; jangan menyatakan sudah teruji end-to-end. Build final tersedia setelah reload.

## 24. Kartu stream hilang setelah probe — 2026-10-23

Pengguna melaporkan AIOStreams tidak muncul walau ditunggu, lalu meminta memastikan
Manual / Only Direct off / labels on untuk AIOStreams sebelum pengujian.

- Bukti: probe backend selesai20/20 tanpa kegagalan, tetapi client-error berulang ReferenceError: o is not defined pada getDeviceCapabilities -> renderStreamCard (build61268d06f38a).
- Penyebab terlokalisasi pada optional DOM method call di default parameter, globalThis.document?.createElement?.("video"), yang diturunkan esbuild untuk target Chromium63 menjadi call dengan receiver variabel di luar scope. Pola yang sama ada pada default mediaElement assessPlaybackCapabilities.
- Tes baru deviceCapabilities.bundle.test.mjs membangun kedua modul dengan target/minify produksi dan menjalankannya dalam konteks DOM tiruan yang memeriksa receiver. Keduanya gagal ReferenceError sebelum patch dan lulus setelahnya. Pembuatan elemen dipindah ke badan fungsi dengan documentRef eksplisit; tidak mengubah klasifikasi/filter/sorting.
- Pengaturan Chrome profil utama awalnya masih First Source bahkan setelah reload; diubah ke Manual sesuai konfigurasi pengujian yang diminta. Only Direct off diverifikasi lewat class toggle; labels on dan scope AIOStreams diverifikasi lewat tampilan. Setting lain tidak diubah.
- Validasi Chrome build6fa82f1b8b0f: Project Hail Mary -> Resume langsung daftar manual.20 kartu AIOStreams selesai dilabeli (10 Direct,4 Remux unavailable,6 Unknown), tanpa Checking tersisa. Torrentio tetap terlihat tanpa playback label. Tidak ada error console dari build baru pada percobaan. Screenshot tampilan diperiksa. Tidak memulai video.
- Semua1348 tes lulus; build sukses; lint kedua helper dan tes bundle lulus; diff whitespace bersih. Cache tidak dihapus lagi saat perbaikan ini. Belum commit.

## 25. Label berdasarkan browser/container aktual dan Direct : HDR — 2026-10-23

- Pengguna meminta Direct : HDR serta menolak aturan blanket MKV atau nama perangkat. Container kini diperiksa lewat MIME browser aktual; H264/HEVC/AV1 dan profil audio diperiksa bersama container sumber. Tidak lagi memaksa semua MKV ke Remux atau MPEG4/DTS unsupported tanpa jawaban API.
- PQ/HLG pada colorTransfer menambahkan Direct : HDR bila video/container/audio didukung. HDR bukan lagi video-capability-unknown; penolakan audio tetap menghasilkan audio-transcode. Tooltip menjelaskan metadata HDR tidak membuktikan keluaran layar HDR/tone mapping.
- Nama perangkat/iOS tidak menentukan label Remux. Retag hev1 hanya jika query tag sumber ditolak dan hvc1 diterima. Hint UA lama hanya tersisa untuk prioritas probe lama. Dukungan container yang belum diketahui tetap Unknown, bukan asumsi MP4/WebM-only.
- Relay remux/audio menghasilkan MP4; codec video output juga diperiksa, termasuk saat memilih track audio sekunder. Penolakan output video memakai alasan relay-output-video-unsupported. Tiap keputusan tetap membawa reason; adaptive manifest belum diverifikasi dan jalur demux/audio Movi tetap Unknown bila belum terbukti.
- Bukti Chrome aktual sebelum patch: keempat MKV berisi AV1/HEVC/H264 dan HE-AAC diterima canPlayType. MKV pertama dimainkan internal player dengan readyState4, waktu maju, errornull, tanpa endpoint remux/transcode. Audibilitas empat MKV berasal dari verifikasi pengguna, bukan metrik audio browser.
- Enam Unknown sebelumnya semuanya PQ/H264: empat AAC didukung; dua AC3 ditolak Chrome. Setelah patch build8359366da93a, Project Hail Mary daftar manual berisi20 label AIOStreams:14 Direct,4 Direct : HDR,2 Transcode (unavailable). Tidak ada Unknown/Remux pada20 kandidat tersebut. Tidak ada error console yang berasal dari build baru. Screenshot direct-hdr-device-rules.png di folder visualizations thread.
- Manual / Only Direct off / labels AIOStreams dipertahankan; Torrentio tetap terlihat tanpa label. Filter/sorting Connected Services tidak diubah. Cache probe tidak dikosongkan; fakta server dipakai ulang, keputusan browser dihitung lokal setelah reload.
- Semua1353 tes lulus, build sukses, diff whitespace bersih. Tes mencakup browser MKV menerima/menolak, PQ/HLG+AAC vs AC3, API tidak tersedia, hev1 diterima meski hint iOS, output MP4 track sekunder, dan target/minify Chromium63. iOS/Android fisik belum diuji. Belum commit.

## 26. Hapus pemaksaan remux MKV saat membuka player — 2026-10-23

- Pemeriksaan sebelum commit menemukan aturan lama lain: Router memanggil applyRemuxSource untuk setiap player, dan helper memaksa URL .mkv ke relay jika REMUX_ENDPOINT tersedia. Ini bisa bertentangan dengan label Direct. Pengguna meminta perbaikan dan uji nyata dengan remux aktif.
- Router kini mempertahankan sumber yang sudah dipersiapkan. applyRemuxSource/shouldRemuxSource dan aturan ekstensi MKV dihapus; remuxSource hanya membangun URL ketika verdict memang meminta remux. StreamScreen tetap menangani verdict remux/audio; komentar warisan diperjelas.
- Regresi dibuktikan sebelum patch: dengan endpoint /api/remux, URL direct.mkv berubah menjadi /api/remux?u=... saat navigate player. Setelah patch URL Direct dan URL relay eksplisit dipertahankan. Tes source preparation membuktikan MKV didukung tidak memanggil relay, sedangkan MKV ditolak container tetap memanggil remux.
- Uji Chrome build0f87944eed83, profil utama, Project Hail Mary kandidat AIOStreams1080p925.1MB (AV1/HE-AAC MKV): server/client remux diaktifkan (/api/remux/health oktrue, client endpoint /api/remux). File aktual Project Hail Mary (2026) AV1 1080p 7RIP.mkv diputar langsung dari torrentio.strem.fun lalu TorBoxCDN. Video1920x1080, readyState4, pausedfalse, errornull, waktu625.61 ->652.17 detik.
- Pemantauan CDP sejak sebelum klik mencatat52 request selama playback, nol permintaan /api/remux. Health server saat bermain active0, usedBytesToday0, egressUsedThisMonth0; proses ffmpeg0. Tidak ada error console dari build baru. Tidak mengklaim pengukuran audibilitas. Screenshot mkv-direct-remux-enabled.png pada folder visualizations thread.
- Remux dikembalikan nonaktif seusai uji, transcode tetap nonaktif, probe aktif dengan kebijakan sama. Restart server untuk perubahan env mereset cache probe memori; tidak menghapus preferensi/profil. Server sekarang PID12176, hidden; log movi-remux-restored.out.log/.err.log di Temp. Browser direload untuk konfigurasi semula dan video sudah dihentikan.
- Semua1351 tes lulus (tes helper otomatis MKV lama diganti tes perilaku yang benar), build sukses, whitespace diff bersih. Filter/sorting Connected Services tidak diubah. Belum commit.
