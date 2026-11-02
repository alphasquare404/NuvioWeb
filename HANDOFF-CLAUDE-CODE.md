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

## 27. Preferensi HDR pada First Source — 2026-10-23

- Pengguna menyetujui card sesudah Auto Stream Selection jika mode First Source: HDR didukung -> Select HDR when available aktif; SDR -> Don’t select HDR streams aktif; kemampuan tidak pasti -> Prefer HDR streams nonaktif. Manual/Regex tidak memakai preferensi ini.
- hdrSupport memeriksa media query video-dynamic-range high/standard; query yang tidak dikenal bukan bukti SDR. Fallback dynamic-range standard tanpa high menunjukkan layar SDR; CSS HDR saja belum membuktikan jalur video HDR, sehingga unknown. Tidak memakai HEVC/AV1/10bit atau UA sebagai bukti kemampuan HDR. Rujukan W3C Media Queries5 dan Media Capabilities. Codec/container sumber tetap diperiksa per file.
- streamAutoPlayHdrPreference disimpan profile-scoped lokal sebagai AUTO/PREFER/AVOID/ANY. AUTO dihitung di perangkat yang memakai aplikasi, tidak disimpan sebagai fakta hardware/sinkronisasi kemampuan. Toggle kembali ke posisi default menghasilkan AUTO lagi. Tidak menambah field sinkronisasi cloud atau mengubah filter/sorting Connected Services.
- Teks seluruh daftar respons addon diperiksa tanpa resolve URL. HDR/HDR10/HDR10+/HLG/Dolby Vision/DoVi/DV dikenali; HDRip/HEVC/10bit/4K atau token URL bukan bukti HDR. Preferensi HDR menempatkan dugaan HDR lebih dulu secara stabil sebelum batas probe/preparation, hanya sesudah scope addon autoplay diterapkan.
- Only Direct aktif: status HDR memakai transfer probe PQ/HLG, bukan teks; hasil codec/container/audio juga harus Direct. Hasil probe yang menyebut SDR mengoreksi teks HDR. Prefer memilih HDR Direct pertama yang diperiksa; tanpa hasil HDR, fallback urutan sumber asal dari kandidat Direct yang sudah diperiksa, dibatasi cap/deadline semula. AVOID tidak boleh fallback ke kandidat HDR yang dikecualikan; manual list mendapat pesan bila semua pilihan ditolak preferensi HDR. Only Direct nonaktif: teks dipakai, metadata probe yang sudah tersedia boleh mengoreksi.
- Kebijakan sama dipakai selector, resolver Detail, Stream, dan episode berikutnya. Preferensi aktif mencegah Reuse Last Link melewatinya; binge group SDR tidak mendahului HDR yang tersedia ketika PREFER aktif. Daftar manual tidak disembunyikan oleh preferensi HDR. Label probing tetap mengikuti izin addon label sendiri.
- Audit jalur episode berikutnya menemukan referensi ke probeModule.streamProber yang tidak diekspor; diganti instance createStreamProber aktual dengan assessment native dan identity file. Batas0 berarti unlimited, prioritas/cap hanya di scope sumber yang diizinkan. Tes menjalankan method sebenarnya dengan prober/assessment tiruan untuk membuktikan kandidat HDR nomor22 diprobe meski cap1 dan addon lain dikecualikan.
- Validasi:1367 tes lulus; build501282898d73 sukses; lint modul HDR/selector/resolver/store lulus; whitespace diff bersih. Tes mencakup tiga status perangkat, card/toggle/default, metadata teks, prioritas di luar20 kandidat, cap, addon permissions, HDR palsu, non-Direct HDR, fallback SDR, AVOID, binge group, episode berikutnya, dan deadline tidak diperpanjang.
- Chrome profil utama awal turn ternyata First Source / timeout20s / Only Direct off (pengguna telah mengubah dari Manual). Dipertahankan seusai tes. Browser melaporkan dynamic-range standardtrue/highfalse, video-dynamic-range keduanya false. Card SDR default aktif; toggle off/on terverifikasi. Only Direct dinyalakan sementara untuk autoplay Project Hail Mary, video AV1 1080p7RIP.mkv berjalan readyState4 pausedfalse errornull, currentTime704.82s. Buffer event jaringan sudah kehilangan bagian awal sebelum dibaca, sehingga jangan mengklaim bukti urutan probe aktual dari sesi ini. Prioritas HDR dibuktikan tes, belum pada perangkat HDR fisik.
- Emulation.setEmulatedMedia dynamic-range high tidak mengubah jawaban Chrome; tidak dipakai sebagai bukti dukungan HDR. Emulasi dikosongkan lagi. Only Direct dikembalikan off; First Source,20s, addon scope dipertahankan. Final Chrome memuat build501282898d73, HDR avoid checkedtrue/OnlyDirectfalse dan tanpa error console dari build final. Screenshot hdr-preference-settings.png ada di folder visualizations thread. Video sudah dihentikan. Remux/transcode tetap off; cache probe tidak dihapus/restart lagi. Belum commit.

## 28. Cache kemampuan perangkat saat startup — 2026-10-24

- Pengguna menyetujui pemeriksaan lokal HDR/codec/container sekali saat aplikasi dibuka, sebelum pemilihan profil. initializeDeviceCapabilitySession dipanggil bootstrapApp sesudah Platform.init dan sebelum I18n/Router/Auth bootstrap. Tidak membutuhkan server, ffprobe, login, atau playback tersembunyi.
- HDR memakai getHdrPlaybackSupport yang menyimpan hasil, termasuk unknown, selama sesi halaman. Settings dan resolveHdrPreference tidak lagi menjalankan detector setiap dipanggil. Codec/container tetap memakai getDeviceCapabilities cached. Reload memulai sesi baru.
- Watcher media query dynamic-range/video-dynamic-range memperbarui snapshot bila browser melaporkan perubahan kemampuan tampilan; listener modern/legacy didukung, event bersamaan digabung. pageshow persistedtrue (BFCache restore) juga memperbarui; pageshow biasa tidak. Tanpa dukungan event, snapshot dipakai sampai reload. Tidak melakukan polling.
- Penilaian per-file di assessPlaybackCapabilities disimpan berdasarkan konfigurasi metadata aktual, engine, scope, dan media element. Konfigurasi identik berbagi promise/hasil, termasuk panggilan bersamaan. Perubahan perangkat membatalkan prediksi lama; perubahan saat assessment berlangsung memicu penilaian ulang sebelum mengembalikan hasil. Jawaban belum pasti boleh dicoba lagi. Cache dibatasi512 konfigurasi per konteks, hanya di RAM, terpisah dari cache fakta file server.
- Semua1374 tes lulus, build79f06983dc54 sukses, lint modul baru/assessment/tests lulus, whitespace diff bersih. Bukti mencakup startup sekali sebelum navigasi profil, event perubahan/BFCache, cache konkuren, metadata berbeda, engine terpisah, recovery Unknown, perubahan saat assessment, dan bundle target/minify Chromium63.
- Chrome build0f3bac271e91 (sebelum guard in-flight terakhir): setelah Profiles, pengamatan sementara pada matchMedia/canPlayType mencatat nol query HDR dan nol canPlayType selama masuk Playback dan close/open General. Wrapper pengamatan dikembalikan ke fungsi asli dan observer dihapus. Preload instrumentation via Page.addScriptToEvaluateOnNewDocument tidak didukung tool; hitungan sejak sebelum bootstrap dibuktikan lewat tes, bukan diklaim dari Chrome.
- Final Chrome build79f06983dc54 mencapai Profiles -> profil utama -> Playback normal, tanpa error console dari build final. FirstSource/20s/OnlyDirectoff/HDRavoidcheckedtrue dipertahankan. Screenshot startup-capability-cache.png ada di folder visualizations thread. Tidak memulai video atau mengubah toggle preferensi.
- Domain sempat502: localhost4173 menolak koneksi dan server lama PID12176 sudah tidak ada. Server eksperimen dihidupkan hidden PID23168; probeon/remuxoff/transcodeoff, ttl86400000/maxEntries5000/maxConcurrent8/rate0/dailyBytes0, ffmpeg/ffprobe Jellyfin. Log movi-capability-startup.out.log/.err.log di Temp. Health sesudah startup requests0, membuktikan tidak ada permintaan probe untuk pemeriksaan perangkat. Tidak melakukan penghapusan cache tambahan.
- Perubahan section27 (preferensi HDR) dan section28 (startup/cache) masih belum commit. Filter/sorting Connected Services tidak diubah.

## 29. UI player mobile dan tindak lanjut audit — 2026-10-24

- Pengguna menolak pemindahan play/pause ke tengah dan perubahan cara seek. Posisi khas Nuvio dan seek setiap gerakan dipertahankan; ditambahkan waktu tujuan pada mouse hover desktop tanpa seek. Lingkaran kontrol mobile memakai secondary-color tema profil.
- Ukuran teks audio/subtitle diperkecil mengikuti layar. Panel kosong memakai tinggi isi. Pemilihan track/engine belum diubah. Pesan No audio tracks available masih perlu dibahas: yang kosong adalah daftar track terpapar, bukan pengukuran audibilitas.
- Long press touch/pen menekan context menu; CSS user-select/touch-callout pada permukaan player mencegah seleksi teks. Klik kanan mouse dipertahankan. Toolbar misses dilindungi berdasarkan koordinat: jika kontrol terlihat, gesture pada/bawah timeline tidak toggle pause. Gesture di atas timeline dipertahankan.
- Pause overlay menampilkan badge Fusion/ukuran dari sumber aktif menggunakan renderer yang sudah ada. Cast membawa foto/peran, meneruskan castItems Detail -> Stream -> Player dan route Player langsung. Identitas actor digabung tanpa duplikasi; metadata kaya melengkapi field kosong. Maksimum8 cast seperti sebelumnya. Belum menambahkan probe baru/label kompatibilitas baru pada pause.
- Layout pause memperhitungkan tinggi layar, Back/jam dan safe area; konten diukur dan diperkecil jika perlu, tanpa scroll. Fit diulang sesudah resize dan gambar selesai/error. Foto gagal memakai inisial. Startup overlay tidak lagi menggambar baris subtitle/runtime; metadata/runtime yang dipakai durasi/timeline tidak diubah.
- Angka default guard terverifikasi lewat fungsi aktual: startup18000ms, playback9000ms. Ini berbeda dari timeout pencarian/pemilihan sumber. Remux mempunyai pengecualian sendiri. Tidak mengubah angkanya atau engine/relay. Uji callback aktual dengan halaman hidden, readyState2, tanpa pause event membuktikan dapat masuk error/sources panel setelah9000ms. onPause biasa membersihkan guard. Uji fisik background/lockscreen iPhone masih belum dilakukan.
- Chrome source nyata Project Hail Mary: readyState4, errornull; Runtime.evaluate debugger mengonfirmasi audioTracks tidak tersedia dan textTracks.length0. Player mengambil native audio dari audioTracks/webkitAudioTracks/mozAudioTracks atau HLS/DASH engine. Metadata ffprobe belum menjadi daftar yang dapat dipilih. Manifest warmup hanya HLS/DASH; subtitle addon/sidecar/offline punya jalur lain. Belum memastikan apakah embedded subtitle ada pada file ini maupun alasan spesifik subtitle addon kosong.
- Fullscreen Chrome desktop berhasil: Runtime.evaluate mengonfirmasi fullscreenElement.id=player lalu keluar lewat tombol. Kode masih memiliki false-success saat requestFullscreen tidak tersedia dan belum memakai fallback video WebKit. Pengguna meminta telusuri, jadi fullscreen belum diubah. Penting: Playwright read-only evaluate bisa tidak mengekspos properti API; pemeriksaan capability harus lewat CDP Runtime.evaluate. Jangan menyimpulkan API tidak tersedia hanya dari wrapper DOM.
- Pengguna mengonfirmasi PiP gagal di iPhone PWA Home Screen. getBrowserPictureInPictureCapability memprioritaskan API standar; NotSupportedError membuat sesi video unavailable. Laporan WebKit303885 masih NEW, membahas API standar terlihat ada di PWA tetapi ditolak, termasuk prefixed capability false. Ini petunjuk, bukan diagnosis perangkat pengguna. Versi iOS belum diketahui. https://bugs.webkit.org/show_bug.cgi?id=303885 . PiP belum diubah.
- Browser: profil utama, preferensi tidak diubah, cache tidak dihapus. Pada buildc3df41dea096 delapan foto/peran cast nyata berhasil, badge SIZE925MB/1080p tampak, tap kosong di bawah toolbar tidak menjeda playback, hover tengah timeline menampilkan1:18:11 tanpa seek. Build804ee4460a6e menambah safe area Back/jam dan fit gambar terlambat. Build final e7d1360a9b70 hanya mempersempit contextmenu ke touch/pen; semua1382 tes lulus, build sukses, diff whitespace bersih. Fullscreen desktop nyata diuji; emulasi ukuran HP bukan pengujian Safari/iPhone fisik.
- Screenshot thread: player-mobile-audio-compact.png dan player-mobile-pause-safe-area.png. Perubahan belum commit. Sesudah pekerjaan ini pengguna ingin membahas hasil lebih lanjut; runtime remux/transcoding, perubahan fullscreen/PiP, filter/sorting Connected Services dan WASM jangan dikerjakan otomatis.

## 30. Penyempurnaan player sesuai umpan balik — 2026-10-24

- Hanya lingkaran play/pause utama mobile mengikuti tema; lingkaran lain dipertahankan. Pause: metadata tahun/episode/runtime/judul episode satu baris dengan dot, badge mengikuti ukuran metadata, konten dipusatkan vertikal dalam safe area dan diperkecil bila perlu tanpa scroll. Cast memakai ukuran fluid dan flex wrap bersebelahan, tidak mengisi lebar desktop.
- Audio/subtitle/speed menjadi popover di atas toolbar; tombol tetap dapat diakses. Pembukaan modal langsung menutup pause overlay. Speed dapat ditutup dengan tombolnya. Episodes memakai dropdown season browser, rail TV dipertahankan; hover/focus dan layout flex episode->stream diperbaiki. Close diberi label aksesibel. Mute menampilkan volume0 tanpa menghapus volume sebelum mute.
- Swipe horizontal touch/pen pada area video menampilkan waktu tujuan/delta, seek hanya saat dilepas. Gerak vertikal, mouse drag, multitouch, pointercancel/blur tidak melakukan seek; doubletap dan hold2x dipertahankan. Jarak selebar video setara maksimal120detik (dibatasi durasi).
- Fullscreen memeriksa API aktual: container standar, lalu video WebKit native; tombol disembunyikan bila keduanya tidak tersedia. Keluar native juga ditangani. Native iPhone memakai kontrol sistem dan belum diuji pada iPhone fisik. Tidak mengubah kebijakan PiP atau timer startup18000/playback9000.
- Chrome build176f768b45eb: audio/subtitle/speed popover berjarak12px di atas tombol; dropdown season1/2 berhasil; sesudah memilih episode hanya stream cards tampil, filter tidak terpotong. Mute/unmute slider0/100 dan volume asli1 dipertahankan. FullscreenElement player terkonfirmasi masuk/keluar. Pause metadata2023 · S2E3 ·54m ·Solo; semua8 cast beserta foto/peran tampil. Ukuran390x844 seluruh isi dalam area y202..642.
- Uji touch CDP kontinu:385 pointermove, preview+47detik; currentTime selama gesture hanya135.47..138.06 (playback normal), sesudah release183.37. Membuktikan seek ditunda sampai release. Emulasi Chrome bukan Safari/iPhone fisik. Screenshot player-swipe-preview-mobile.png, player-pause-mobile-final.png, player-pause-desktop-final.png dan player-episode-stream-layout-fixed.png pada folder visualizations thread.
- Pengguna memastikan sumber Silo S2E3 1080p1.23GB. Sumber AIOStreams SIZE1.2GB dipilih, file aktual Silo S02E03.mp4, readyState4/errornull/durasi3269.69. Chrome tidak mengekspos audioTracks; textTracks kosong, UI Audio kosong/Subtitle None. Ini bukan bukti track tidak ada dalam file. Sumber244MB/767MB juga tidak mengekspos daftar track di Chrome. Subtitle addon memang dimatikan pengguna. Pembandingan pada Safari/PWA pengguna belum tersedia.
- Bug WebKit303885 masih NEW saat pemeriksaan; bukan diagnosis pasti perangkat pengguna. Viewport adaptation sudah ada. OS integration berarti kontrol judul/playpause pada lockscreen; belum memperluas metadata MediaSession. Accessibility ditunda pengguna.
- Semua1389 tes lulus, diff check bersih; build final c1e5ae2f8d32 (tambahan toggle-close speed setelah UI utama diverifikasi pada176f768b45eb). Preferensi tidak diubah/cache tidak dihapus. Touch emulation/viewport override dan listener pengujian dibersihkan, playback dihentikan lewat Back. Belum commit.

## 31. Konsistensi label/filter di player dan responsive panels — 2026-10-24

- Ditemukan Sources dan episode-stream picker hanya memfilter nama addon dan tidak menggambar playback label. Auto-next Only Direct sudah mengklasifikasi hasil probe, tetapi scope labelAddons belum diterapkan. Ditambahkan playerStreamPolicy (scope label, target probe dengan cap/HDR, filter Direct) dan integrasi kedua daftar; scope label juga dipakai sebelum cap probe auto-next. Label OFF hanya menyembunyikan label; Only Direct tetap membutuhkan hasil probe dari addon label yang diizinkan. Only Direct OFF mempertahankan semua addon.
- Probe panel browser dimulai hanya saat daftar dibuka, maksimum5 permintaan aktif, memakai assessment native dan identity/cache backend yang sudah ada. URL direct-debrid tanpa URL diselesaikan lewat resolver existing dengan konteks episode yang benar. Hasil/proses/gagal terpisah per mount, jawaban mount lama diabaikan. Rendering memakai renderStreamPlaybackBadge yang sama dengan StreamScreen termasuk health relay; tidak memindahkan logika codec/container. Gagal tetap Unknown dan tidak lolos Direct; tidak mencoba ulang otomatis selama mount sama.
- Pause badge renderer menerima sizeLast khusus pause: badge stream lebih dulu, SIZE terakhir. Tema primary play/pause kini berlaku desktop juga. Panduan Profanity/Nudity adalah Parental Guide: posisinya safe-top+72px, di bawah Back. Controls padding melindungi metadata judul/episode/tahun di atas seekbar. Back sendiri ditemukan belum menghormati inset-top pada landscape dan kini diperbaiki.
- Panel episode/source responsif terhadap lebar/tinggi viewport: padding safe area, typography/thumb/logo fluid, list flex scroll, header/filter tidak terpotong. Pada320px ditemukan Back menimpa judul Episodes; panel sekarang di lapisan52 di atas Back50 saat menutup area tersebut, dengan Close panel sendiri. Nama addon diberi ruang agar tidak pecah satu huruf pada HP.
- Volume Chrome sebelum patch:35%->mute->unmute kembali35%, gejala100% belum terulang. Ditemukan fallback lastAudible dapat menimpa volume aktual jika mute berasal dari luar slider; unmute sekarang mengutamakan volume aktual nonzero, fallback lastAudible bila0. Tes membuktikan external mute volume.35 dengan last1 tetap.35 dan fallback0 mengembalikan.35. Tidak mengklaim penyebab pasti laporan pengguna sudah direproduksi.
- Preferensi showPlaybackLabels/labelAddons disimpan StreamBadgeSettingsStore; showOnlyDirectStreams/streamAutoPlayHdrPreference di PlayerSettingsStore. Keduanya profile-scoped localStorage, terpisah dari cache probe. Adapter sinkronisasi cloud belum mengekspor keempat field tersebut; tidak mengubah kontrak sync. Profil utama tetap labels true/AIOStreams, OnlyDirect false, mode MANUAL, HDR AVOID setelah uji. Tidak menghapus cache.
- Chrome nyata buildf069: OnlyDirectOFF54 kartu (9AIO label,45Torrentio tanpa label) pada Sources maupun episode picker. OnlyDirectON5AIO Direct pada kedua daftar, tidak ada Torrentio/transcode/unknown. Filter tetap menunggu probe, bukan fallback list penuh. Teks settings yang masih menjanjikan fallback penuh diperbarui. Auto-next dibuktikan tes method aktual: source scope dan label scope sebelum cap, HDR prioritas dalam scope, manual auto-next tetap scope label. Belum memutar episode otomatis sampai akhir di perangkat fisik.
- Build83ddcf666a27: OnlyDirect5terverifikasi lagi; simulasi390x844 insettop47/bottom34 memberi Back y59..103, ParentalGuide top119, metadata dalam area aman. Header Episodes y59..99; semua panel tidak overflow horizontal. Uji320x568 dan844x390 daftar tetap dalam viewport; list landscape y160..378. Pause urutan1080p,APPLE TV+,SIZE767MB terkonfirmasi. Screenshot player-only-direct-mobile-final.png, player-episodes-safe-final.png, player-pause-badge-order-final.png di folder visualizations thread. Build final46d643b0a2f1 hanya melonggarkan lebar nama addon sesudah screenshot.
- Semua1394 tes lulus, lint JS yang disentuh lulus, build final sukses dan diff whitespace bersih. Viewport override dan CSS safe-area simulasi dibersihkan, playback dihentikan, preferensi OnlyDirect dikembalikanfalse. Tidak mengubah filter/sorting Connected Services, full transcoding, PiP ataupun timer18/9detik. Belum commit.

## 32. Desain panel episode dan stream — 2026-10-24

- Sesuai permintaan pengguna, drawer episode (termasuk stream view-nya) memakai background solid black #000, border halus, kartu charcoal, kontras teks/title/date/overview lebih teratur, current episode bernuansa tema. Safe-area dan layout responsive dipertahankan. Tombol Close tetap40x40, kini lingkaran50% dengan SVG X20x20 tepat di tengah; border/background/blur sama dengan keluarga tombol Back halaman lain. CSS pseudo-X lama dinonaktifkan di browser. TV tetap text Close dan tampilan asal.
- Stream view browser memakai normalizeSourceForDisplay/renderBrowserSourceCardContent yang sama dengan halaman Stream; aturan CSS kartu Stream dibagikan melalui selector tambahan untuk episodeSidePanel tanpa mengubah selector/perilaku halaman Stream asal. Ikon play, facts, badge sesuai preferensi, divider dan identitas addon konsisten. Label playback tetap renderer/filter/probe hasil section31; ditempatkan dalam flow agar tidak bertabrakan di panel sempit. Tidak menambahkan fitur download ke panel. Sources utama player tidak didesain ulang pada langkah ini.
- Filter rail addon browser diganti dropdown Source dengan Reload lingkaran di sampingnya; Back lingkaran dan metadata episode pada baris terpisah. Native select memakai handler change, validasi addon dan pengembalian fokus; TV tetap rail dan tombol teksnya. Pemilihan kartu tetap menggunakan data-episode-stream-index/jalur playEpisodeFromPanel asal.
- Chrome build31fbda9ff176: latar rgb0,0,0; Close40x40, ikon20x20 dengan offset10px setiap sisi, radius50%, pseudo none. Ukuran390x844 dan320x568 panel muat tanpa overflow horizontal; desktop panel460px dan daftar scroll dalam viewport. Dropdown AIOStreams9kartu dan Torrentio45kartu; Back kembali ke episode dan Close menghapus panel sesudah animasi. Memilih kartuAIO1080p766.7MB membuka player kembali.
- Screenshot: episode-drawer-black-mobile.png, episode-stream-drawer-mobile.png, episode-stream-drawer-320.png, episode-stream-drawer-desktop.png pada folder visualizations thread. Semua1395tes lulus, lint player/new test lulus, build sukses, diff check bersih. Preferensi dan cache probe tidak diubah. Belum commit.
- Akhir uji: pemilihan kartu766.7MB menghasilkan readyState4/errornull dan panel tertutup. Viewport override dibersihkan, playback dihentikan lewat Back dan Chrome berada di detail Silo. Uji pemilihan episode memulai episode dari awal seperti alur panel sebelumnya; tidak mengklaim progres tontonan dipertahankan.

## 33. Header sticky drawer player sesuai rancangan — 2026-10-24

- Pengguna menyetujui identitas media seperti heading Stream mobile navbar bawah/siderail: logo atau judul di tengah, subtitle series Sx Ex · judul episode; film genre · tahun (fallback subtitle jika metadata kosong). Back/X tanpa lingkaran sejajar logo. Root Sources dan Episodes hanyaX; stream setelah memilih episode mempunyai Back ke Episodes danX untuk menutup seluruhpanel.
- getPlayerDrawerIdentity/applyPlayerDrawerHeader membentuk header bersama browser dengan memindahkan kontrol yang sudah ada (data-action/fokus tetap). Genre diteruskan Detail/Stream ke Player dan metadata hasil hidrasi. Logo menampilkan fallback judul sampai load berhasil; error tetap judul, tidak menggambar keduanya sekaligus. TV mempertahankan tampilan/handler lama.
- Header terdiri dari identitas media dan toolbar: Streams + Source dropdown + refresh; Episodes + Season dropdown tanpa refresh. Source root sekarang dropdown, memakai setSourceFilter existing. Daftar scroll sendiri di bawah header flex non-shrink/sticky, dengan divider, padding safe area, kontrol44px dan ikon24px tanpa border/radius/circle. Satu season pun mendapat dropdown agar susunan stabil.
- Chrome build36a23375a945: Sources root0Back/1Close, subtitleS2E3Solo, filterAIO9; Episodes0Back/0Refresh dan subtitleepisodeaktif3; memilih TheHarmonium menghasilkanheaderS2E4 denganBack/Close. Back kembaliEpisodes menampilkanS2E3. Borderikon0/radius0 terkonfirmasi. Scroll Sources568px, Episodes324px, streamEpisode300px: header top tetap0. Lebar320/390 tidak overflow horizontal. Screenshot player-stream-sticky-header.png, player-episodes-sticky-header.png, player-nested-stream-header.png dan player-nested-stream-header-top.png di folder visualizations thread. Pakai Page.captureScreenshot untuk viewport tepat; screenshot ekstensi sempat terskala. Tunggu animasi drawer selesai sebelum screenshot.
- Semua1397tes lulus (termasuk identitas episode aktif vs pilihan dan genre/tahunfilm), build sukses, diff check bersih. Lint PlayerScreen/test/Detail lulus; lint StreamScreen masih3unusedimport tracePlayback/traceUrlKind/traceHost yang sudah ada diHEAD sebelum perubahan, tidak dibersihkan di tugas ini. Genre/tahunfilm dibuktikan unit test dan penerusan metadata; browser nyata diuji series.
- Viewport/touch emulation dibersihkan, playback dihentikan lewat Back. Preferensi profil dan cache probe tidak diubah. Tidak commit.

## 34. More Actions tidak lagi memicu gesture video — 2026-10-24

- Baseline section29–33 sudah commit b9023200 feat(player): unify controls and stream drawers. Pengguna mengizinkan perbaikan More Actions setelah investigasi membuktikan tombol diperlakukan sebagai area video: pointer capture root mengalihkan pointerup/click sehingga Mute dan Speed hanya toggle pause/resume.
- isDesktopVideoAreaClick kini mengecualikan .player-mobile-more-panel, termasuk tombol, ikon/teks anak dan padding panel di atas timeline. Tidak mengubah handler tiap aksi atau gesture area video lainnya. Tes regresi memakai method aktual, gagal sebelum patch pada mute button dan lulus sesudahnya; controls visible/hidden serta area video biasa dicakup.
- Semua1398tes lulus; lint PlayerScreen/mobileUx test dan git diff check bersih. Build3d3ee1686156 berhasil. Chrome build tersebut pada390x844 memutar Silo S2E3 sumberAIO1080p766.7MB: Mute menjadi mutedtrue, Unmute kembalifalse, speed dialog terbuka dan1.25x mengubah playbackRate1.25; Aspect berubah Fill -> Stretch -> Fit. paused tetapfalse sepanjang aksi, termasuk pemeriksaan terpisah sesudah tap. Screenshot more-actions-speed-fixed.png di folder visualizations thread.
- Kecepatan dikembalikan1x, mutedfalse dan aspectFit; viewport/touch emulation dibersihkan lalu playback dihentikan lewat Back. Preferensi profil/cache probe tidak diubah. Pengujian Chrome memakai viewport mobile, bukan iPhone fisik; PiP tidak diuji ulang. Patch section34 belum commit.

## 35. More Actions tetap terbuka saat mengubah rasio — 2026-10-24

- Section34 sudah commit bf54531e. Atas permintaan pengguna, aksi aspect kini hanya cycleAspectMode tanpa menutup More Actions. Tes method aktual gagal sebelum patch dan lulus setelahnya untuk tiga pilihan berulang.
- Tambahan permintaan: klik/tap di luar panel menutup More Actions melalui dismissDesktopPlayerPanelFromPointer, merender kontrol dan memperbarui auto-hide. Selama More terbuka, isDesktopVideoAreaClick mengembalikanfalse sehingga pointer tidak ditangkap gesture video dan tidak menjadwalkan pause/seek/hold untuk tap penutupan. Isi panel tetap menjalankan aksi; Back/Escape yang sudah ada dipertahankan.
- Semua40tes player/gesture terkait lulus, lint kedua file bersih, build2972ea97fdcd berhasil, diff check bersih. Belum diuji ulang di browser/perangkat fisik untuk perubahan section35. Belum commit.

## 36. Notifikasi, panel track dan safe area mobile — 2026-10-24

- Permintaan pengguna enam poin: player-aspect-toast (termasuk pesan PiP gagal) kini override browser dengan ukuran/gaya kapsul pull-to-refresh,13px/34px minimum, wrap dan safe-area; tidak mengubah deteksi/fungsi PiP. Pause metadata berurutan episodeCode · episodeTitle · releaseYear · runtime, tanpa field kosong.
- Subtitle portrait: language row mengikuti isi dengan max100px dan scroll bila banyak, menggantikan jatah fr/min90px yang menyisakan ruang kosong. Pembatas horizontal antarbahasa/pilihan/style pada portrait dan vertikal pada landscape; audio mendapat pembatas track/kontrol. Kolom subtitle fleksibel; ukuran font/isi track tidak dirombak.
- positionTrackDialogs mengukur batas bawah Back aktual dan memberi jarak10px, membatasi maxHeight sampai di atas toolbar. Lebar/posisi juga menghormati safe area kiri/kanan, box-sizing border-box. Dialog tetap di atas tombol pemicunya.
- Drawer Sources/Episodes landscape ponsel memakai padding lokal12px kiri/kanan, sedangkan panel di-inset dari tepi kanan layar untuk menghindari notch. Safe area layar kiri tidak lagi diduplikasi dalam panel kanan. Portrait/desktop memakai padding asal.
- Fullscreen PWA disembunyikan sejak render melalui capability dan saat sync tools. Memakai isAppInstalled existing: display-mode standalone atau navigator.standalone iOS. Browser biasa tetap memakai capability fullscreen. Tidak mengubah PiP atau gesture fullscreen shortcut.
- Semua1402tes lulus sebelum pembatasan terakhir guard More Actions ke compact saja;32tes player lulus sesudahnya. Lint PlayerScreen/test bersih; build finaledf15402fc61 sukses. Final guard mempertahankan gesture desktop saat toolbar More diperluas.
- Chrome5dcb378514ba: subtitle fixture empat native text tracks lokal sementara;390x844 safe top47/bottom34 memberi dialogtop113 vs Backbottom103, tanpa ruang kosong bahasa, kedua divider terlihat. Sources landscape844x390 safeleft/right47: panelx317/width480, heading/list paddingkiri/kanan12px. Screenshot player-subtitle-sections-portrait.png dan player-stream-landscape-padding.png.
- Chromed711ae5169b5: subtitle landscape setelah resize selesai rect59,66,726,233 berada dalam notch inset47+12 dan di bawah Backbottom56; audio rect213,66,540,233 dengan divider1px. Metadata nyata S2E3 · Solo · 2023 · 54m. Simulasi navigator.standalone true + volumechange sync menyembunyikan fullscreen (hiddentrue); override dihapus sesudah uji. Screenshot player-pause-metadata-pwa.png dan player-notice-capsule.png (toast diuji lewat Aspect, tidak memaksa PiP gagal).
- Section35 kini diuji Chrome: Aspect Fill -> Stretch -> Fit tetap membuka More; tap area video menutup More dan paused tetapfalse pada pemeriksaan terpisah. Screenshot Page.captureScreenshot landscape subtitle dua kali timeout; ukuran akhir dibuktikan DOM, tidak mengklaim screenshot itu tersimpan.
- Tidak menguji iPhone fisik. Track fixture lokal dibuang bersama video setelah Back; safe-area/standalone/viewport/touch override dibersihkan, playback dihentikan, Chrome dihalaman Stream. Tidak mengubah preferensi profil/cache probe. Section35–36 belum commit.

## 37. Toolbar berhalaman, orientasi player dan tindak lanjut iPhone — 2026-10-25

- Pengguna meminta satu baris playback: Play/Pause tetap paling kiri; runtime, mute/volume, PiP dan fullscreen tetap kanan; tombol tengah berurutan dari sebelah Play dan berhalaman jika penuh. browserToolbar paginate helper menghitung slot dari lebar row/kelompok kanan dan ukuran tombol, panah Next hanya bila ada halaman berikut, Previous setelah halaman pertama. Resize meng-clamp halaman. More popup browser lama dinonaktifkan; jalur TV tetap memakai definisi kontrol asal. Rotate punya SVG sendiri. Browser external chooser masuk kumpulan tombol tengah.
- Fokus subtitle browser dipisahkan dari state selected: pointer tidak menggambar fokus TV dan tidak auto-scroll ke item fokus. Posisi tiap rail dipertahankan saat rerender; keyboard tetap dapat menggerakkan fokus. Tes renderer aktual memastikan item selected tetap ada, kelas focused tidak muncul untuk sentuh dan scrollTop0/140/30 tetap.
- Pause overlay kini menyertakan node Ends at yang sudah didukung updateUiTick. Back Player memakai varian Stream heading transparan pada layout mobile yang kembali ke Stream, atau varian floating/circle Detail; posisi memakai aturan asal. Chromebuild1943: Player dan Stream sama-sama rect12,17,44,44 pada portrait.
- Volume dideteksi dari hasil write/read aktual, tidak asumsi UA. Jika volume software ditolak (contoh getter selalu1/setter diabaikan), slider dinonaktifkan dan toast Use your device volume buttons muncul; mute tetap bekerja. Pada browser normal, nilai terkonfirmasi disimpan dan dipakai saat unmute. Chrome35% -> mute -> unmute kembali35%. Apple mendokumentasikan batas volume iOS: https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/Using_HTML5_Audio_Video/Device-SpecificConsiderations/Device-SpecificConsiderations.html . Tidak mengklaim gain software bekerja di iPhone.
- Snapshot timing cue kini mengikuti perubahan start/end dari demuxer, tanpa menambahkan delay berulang. Default delay0 tidak lagi menulis ulang timing yang sama setiap cuechange; posisi cue juga tidak ditulis ulang jika sama. Ini memperbaiki kelemahan yang terbukti lewat tes, tetapi penyebab persis subtitle menumpuk pada file pengguna BELUM dikonfirmasi di Safari/iPhone. Tidak memotong cue yang memang overlap atau menebak durasi maksimal. Native cue diberi lift sesuai overlap video/seekbar saat kontrol tampil; HTML subtitle default memakai offset kontrol yang sudah diukur.
- Pengguna secara eksplisit menyetujui fallback memutar seluruh canvas90deg bila native orientation.lock ditolak. Modul browserPlayerOrientation default landscape untuk perangkat sentuh, native lock dicoba tanpa memaksa browser fullscreen, CSS canvas fallback bila perlu; Rotate berganti portrait/landscape, viewport berubah tetap mempertahankan pilihan. Preferensi orientasi ikut perpindahan episode selama sesi, default landscape saat masuk baru. Coordinate mapper dipakai gesture/seek/hover, popover, pause fit, subtitle lift dan scroll episode. Video asli memang anak #player sehingga ikut transform. Dialog eksternal body juga ikut canvas ketika rotated. Lifecycle membersihkan resize/listener/body class/CSS vars dan hanya melepas lock native milik sesi tersebut. Laporan WebKit relevan (bukan bukti versi iOS pengguna): https://bugs.webkit.org/show_bug.cgi?id=257695 .
- Uji Chrome menemukan min-height100dvh lama membuat canvasrotasi844x844. Diperbaiki min-height0: canvas lokal844x390 kini menghasilkan rect layar390x844 di0,0, tanpa CSS debug pada buildab48330859e3. Portrait320 rowclientWidth296=scrollWidth296; semua tombol satu baris. Halaman390: Next/Subtitles/Audio -> Previous/Sources/Episodes/Rotate/Next -> Previous/Speed/Aspect. Browser screenshot capture kadang timeout saat video bergerak; jangan menyebut file player-toolbar-320.png sebagai bukti toolbar karena file itu masih menampilkan pause overlay.
- Gesture uji via Input.dispatchTouchEvent terpisah terlalu lambat dan memicu hold550ms. SynthesizeScrollGesture satu gesture cepat dipakai sebagai bukti: dengan CSS touch-action video none, swipe lokal pada canvas berputar mengubah time1021.404 ->1004.5454, feedbackseekminus19s, rate tetap1; posisi dikembalikan setelah uji. Sebelum patch, trace membuktikan pointercancel oleh browser. Panel rotated juga membutuhkan scroll sumbu lokal: binder khusus scroll-only untuk rail/list yang scrollable, threshold6px, capture saat drag, suppress trailing click400ms; panel tidak memicu kartu saat selesai scroll. Saat canvas tidak rotated, scroll browser biasa dipertahankan.
- Dialog eksternal bukan flex-wrap column lagi: satu kolom nowrap, actions overflow-y auto, ukuran panel dibatasi canvas. Chrome simulasi iOS sementara (platformMacIntel/touch2, bukan perubahan profil): empat player+copy/cancel tersusun x201, y93/156/220/284/348/411, clientWidth=scrollWidth444, clientHeight268<scrollHeight360. Tidak memilih player/Copy/link sehingga tidak meluncurkan aplikasi eksternal. Screenshot player-external-vertical-scroll.png tersimpan. Override platform dibuang.
- Drawer Stream/Episodes kembali right0, widthmin480/100%; safe inset kanan diterapkan pada isinya. Root mengandung local safe-area mapping saat diputar. Chrome rotated Sources: panelRight844=canvas844.
- Auto-next dan pergantian episode manual kini meneruskan handoffReturnRoute, returnToStreamOnBack, streamRouteParams dan asal Detail sambil tetap replaceHistorytrue. Sebelumnya returnToStreamOnBack dipaksa false dan handoff hilang; Back lalu membuat Detail sintetis dengan Player tertinggal di riwayat. Tes async method playNextEpisode aktual membuktikan route Player direplace dan tujuan Detail serta konteks search tetap. Belum menjalankan sampai akhir episode untuk uji popstate fisik iPhone.
- Gate final:1412tes lulus, lint JS yang disentuh bersih, buildc501f6e691f7 berhasil. CSS desktop punya formatting debt lama; tidak diformat ulang seluruh file. Diff check bersih. Section35–37 dan file baru masih belum commit.

- Penutupan section37: buildfinald17f6c586198 (perbedaan browser dengan0084hanya wrapper kanan tidak lagi dibuat di TV). Gate seluruh1412tes dan lint final lulus;52tes player/gesture lulus setelah perubahan terakhir. Ukuran toolbar kini memakai data-player-toolbar-size berdasarkan lebar canvaslokal, bukan hanya mediaquery fisik; panel track juga memakai orientasi pilihan. Primary pointer coarse menentukan mode mobile, maxTouchPoints hanya fallback jika matchMedia tidak tersedia.
- Chrome0084c0ac436f tanpa style debug: startup phone390x844 menghasilkan canvaslokal844x390 dengan ukuran regular. Scroll Sources pada canvasrotated via satu touchgesture mengubah scrollTop0 ->115; Close berhasil dan panelRight tetap di844. Setelah device landscape, rowwidth788=scrollWidth788; screenshot player-controls-single-row-final.png memperlihatkan video/kontrol nyata. Rotate keportrait sewaktu layar fisik844x390 menghasilkan canvas390x844, sizecompact, row334=scrollWidth334, dengan pagination.
- Semua simulasi platform, styledebug, metrik dan touch dibersihkan; bodyrotatedfalse dan canvasCSSvar kosong setelah Back. Playback dihentikan di Stream. Selama debug SiloS2E4 sempat berjalan; posisi dikembalikan ke7:35, yaitu titik awal yang sudah tercatat pada pengujian pertama, sebelum flush/Back agar durasi debugging tidak menjadi progres tontonan baru. Tidak memilih/memainkan episode lain atau memicu auto-next nyata; tidak mengubah preferensi profil/cacheprobe. Nomor7 tetap perlu verifikasi file yang dilaporkan pada iPhone/PWA fisik.

## 38. Ukuran tombol toolbar seragam (2026-10-25)

- Semua tombol toolbar browser (Play/Pause, aksi tengah, Mute, PiP, Fullscreen) memakai variabel ukuran bersama: regular 36px / ikon 24px; compact 26px / ikon 20px; small 24px / ikon 18px. Semua tombol persegi; warna tema Play/Pause dipertahankan. Aturan gambar dan ikon primary lama sudah dioverride pada selector yang tepat.
- Build e6dfe93de1f8 berhasil; 26 tes toolbar/mobile UX lulus; diff check bersih. Chrome memverifikasi computed sizes pada lebar 1280, 390, 320 serta row tanpa overflow (1203/1203, 366/366, 296/296). CSS final dimuat sementara ke halaman untuk memeriksa aturan terbaru karena stylesheet tunnel masih menyajikan versi sebelumnya; style verifikasi dihapus setelah selesai.
- Screenshot player-buttons-equal.png di folder visualisasi sesi. Video dihentikan melalui Back, posisi uji dikembalikan 7:35; emulasi viewport dan bypass cache/SW dibersihkan. Belum commit.

## 39. Revisi orientasi dan laporan PWA iPhone (2026-10-25)

- Disetujui: awal landscape, setelah rotasi fisik mengikuti orientasi perangkat; Rotate manual berlaku sampai rotasi fisik berikutnya. Tidak lagi meminta native orientation lock, agar rotasi fisik tetap dapat diterima. Memakai screen.orientation / window.orientation; viewport-axis fallback bila keduanya tidak tersedia. Resize satu sumbu saja tidak menghapus pilihan manual; sinyal orientation yang mendahului resize menunggu bounds cocok. Putaran fallback +90/-90, koordinat pointer/rect, dialog, dan safe-area ikut arah rotasi. Preferensi terbaru diwariskan antar episode.
- Back mobile memakai posisi safe-area lokal yang sama di canvas portrait/landscape. Padding horizontal isi drawer landscape diperkecil 12 menjadi 8px di luar safe area; portrait/desktop dipertahankan.
- Fokus ganda: onPointerActivate meneruskan tap ke handleSubtitleDialogKey yang sebelumnya mengaktifkan subtitleKeyboardNavigation=true. Sekarang asal pointer ditandai sehingga highlight keyboard/TV tidak diaktifkan oleh tap. Repaint native cue tertunda juga tidak boleh mengaktifkan kembali track lama setelah selection token berubah.
- Track metadata/chapters tidak ditampilkan sebagai opsi subtitle Unknown; indeks native asli tetap dipakai. Pemilihan subtitle controller tidak menonaktifkan timed metadata. Track hidden selama repaint tidak membuat pilihan berpindah ke metadata.
- Posisi cue persen tidak lagi diubah menjadi satuan baris ketika dinaikkan di atas seekbar. Posisi/alignment horizontal yang ditetapkan file tetap dihormati. Keluhan subtitle di kanan pada iPhone BELUM terbukti akar masalah dan BELUM dinyatakan selesai; butuh cue sumber/perilaku Safari aktual. Tidak memaksa semua cue ke tengah karena bisa menghilangkan posisi subtitle yang disengaja.
- Volume: tombol Mute menyimpan restore volume tersendiri; unmute dilakukan sebelum mengembalikan volume supaya reset nilai pada muted tidak menang. External mute tetap memakai nilai volume aktual. User mengizinkan slider disembunyikan HANYA bila setter volume terbukti ditolak; perangkat iPhone tidak dijadikan alasan untuk menyembunyikan. Slider supported tetap ada. Nilai restore direset pada mount dan perubahan volume manual.
- Build 445ee879deba; 1420 tes lulus, ESLint/Prettier JS/diff-check lulus. Browser Chrome 3 sempat terlihat pada Detail Silo (user sudah Next S2E5); tidak mengubah progres tontonan. Tab pengujian terpisah dibuat pada localhost4173; koneksi browser terputus saat persiapan fixture, lalu Browser is not available:3, sehingga penutupan tab uji gagal dan verifikasi visual belum tersedia. Tidak ada bukti visual iPhone dari tes ini. Belum commit.

## 40. Koreksi setelah umpan balik iPhone: addon/native ganda, Back, gutter, volume (2026-10-25)

- User menegaskan poin4 adalah volume setelah unmute. Orientasi tidak dikerjakan ulang pada putaran ini. Back sekarang ikon tanpa border/lingkaran/background/backdrop, mempertahankan hit target dan posisi. Gutter luar daftar episode/stream landscape benar-benar 0 kiri/kanan (bukan 8px); portrait/desktop dipertahankan. Header landscape memakai content-padding0 dan tetap safe-area.
- Dua pilihan subtitle berhasil DIREPRODUKSI sebelum patch dalam dua tes yang gagal: (1) boundary builtin stale mencakup TextTrack addon yang baru dimount; (2) HLS builtin stale-selected sementara selectedAddonSubtitleId aktif. Sebelumnya penanganan fokus pointer/metadata belum menyentuh kedua mekanisme ini.
- getSubtitleEntries menggunakan identitas node.track untuk mengecualikan addon dari builtin walau boundary angka salah; native index asli dipertahankan. selectedAddonSubtitleId/selectedManifestSubtitleTrackId menentukan pemilik seleksi sehingga builtin tidak ikut checked. resolveBuiltInSubtitleBoundary mengutamakan identitas track addon; registrasi externalTrackNodes dilakukan SEBELUM appendChild, karena addtrack dapat terpicu saat append. Aktivasi addon tidak menonaktifkan timed metadata. Kedua tes gagal tadi sekarang lulus.
- Posisi built-in: aturan author CSS transform translateY pada kedua pseudo-element native dihapus. Offset vertikal kini individual translate hanya pada container, sehingga tidak menggantikan transform posisi milik cue/browser atau menggandakan offset pada container dan cue. Ini memperbaiki intervensi CSS yang berisiko, namun BELUM ada bukti visual bahwa kasus kanan di Safari iPhone sudah terselesaikan. Sumber WebKit ditinjau (text-tracks.css dan VTTCue/TextTrackCueGeneric); jangan menyatakan snapshot Safari aktual sudah diinspeksi.
- Volume: verifikasi setter tidak lagi hanya readback sinkron: recheck pada animation frame menangkap nilai yang dikembalikan browser setelah write. Mismatch menyembunyikan slider dan menunjukkan pesan tombol volume perangkat; write yang diterima mempertahankan slider. Revision mencegah pemeriksaan write lama menganggap perubahan baru sebagai readonly. Slider compact48/small44px menggantikan26/24px; thumb eksplisit12px agar travel tidak habis oleh thumb native iOS. Track fill memakai nilai volume aktual/0 saat mute. Nilai mute restore dari revisi39 tetap dipakai; tidak menggambar nilai volume sistem fiktif.
- Build 3b271ce042a3. Server localhost4173 dan tunnel movi.alphasquare.my.id sama-sama menyajikan ID ini. 1424 tests pass; ESLint targeted dan diff-check bersih. Chrome3 masih Browser is not available; user diminta mengaktifkan koneksi lagi (async question belum dijawab). Tidak menghapus cache, tidak mengganti profil, tidak memutar tontonan. Verifikasi visual belum dikerjakan, sehingga belum ada screenshot final dan jangan mengklaim hasil iPhone sudah tuntas. Belum commit.

## 41. Devserver pulih, bukti Safari asli, dan revisi Skip/Next (2026-10-25)

- User meminta devserver dinyalakan kembali. Port4173 semula tidak listen dan Chrome502. Server pertama sesi ini PID3740 kemudian direstart dengan flag diagnosis lokal menjadi PID18196, node scripts/serve.mjs di worktree ini, WindowStyleHidden. Log stdout: %TEMP%/nuvioweb-movi-native-debug.log; stderr: %TEMP%/nuvioweb-movi-native-debug-error.log. Tunnel kini HTTP200, build8d4102346f49. Server dibiarkan hidup sesuai permintaan.
- Browser inventory baru: Chrome adalah ID2, tab utama276727348, bukan ID3 lama (sekarang IAB). Chrome berhasil dipakai. Profil utama AlphaSquare dibuka; tidak memainkan stream pengguna atau mengubah progres/preferensi/cacheprobe.
- Builtin hilang setelah memilih addon: getSubtitleEntries sekarang memisahkan track SEMATA berdasarkan identitas externalTrackNodes[].track, tidak memakai boundary urutan sama sekali. Indeks native asli dipertahankan. Track bawaan tetap ada walau addon disisipkan sebelum builtin, atau addon dihapus sementara hitungan lama stale.
- Posisi builtin browser: browser tidak lagi mengubah line/snapToLines/position melalui applySubtitleCueVerticalOffset. Penulisan geometri cue native dapat mengganggu default compositor Safari; native sekarang tetap memiliki seluruh layoutnya. Pengangkatan di atas seekbar dilakukan pada container native dengan individual CSS translate, berdasarkan overlap rect video aktual dan seekbar, plus user vertical offset. TV tetap memakai jalur layout cue sebelumnya. syncPlayerOverlayLayoutState dan viewport sync memanggil updateBrowserNativeSubtitleOffset. Jangan mengembalikan pemanggilan getBrowserSubtitleLiftLines yang sudah dibuang.
- Diagnosis perangkat asli memakai endpoint /api/debug/log yang sudah ada. Devserver menyisipkan global **NUVIO_SUBTITLE_DEBUG** sesuai env NUVIO_SUBTITLE_DEBUG=1; defaultfalse jika server dijalankan biasa. reportNativeSubtitleLayout mengirim paling banyak6 kombinasi selection/controls/fullscreen/language per player mount, hanya saat native cue aktif, mengecualikan addon. Tidak ada URL media, teks subtitle, atau label file. Payload berisi geometri, properti cue, dan kind/language/mode track. Tests membuktikan opt-in/batas/redaksi. Setelah investigasi selesai jalankan ulang server tanpa flag untuk mematikannya.
- Dua sampel Safari asli SUDAH MASUK: nativeFullscreen=true/controlsfalse dan nativeFullscreen=false/controlstrue. Keduanya cue lineauto, positionauto, positionAlignauto, aligncenter, snapToLinesfalse; satu track showing. Video rect754x316 x0/y49. Ini bukti cue tidak meminta rata kanan, belum bukti piksel teks iPhone sudah di tengah. User masih perlu melaporkan tampilan inline vs fullscreen dan sumbernya (async question sudah disampaikan). Tidak meminta Mac/kabel; cukup memainkan ulang dan sampel masuk ke server ini.
- Temuan dari sampel Safari: track kinds adalah subtitles/forced/subtitles/forced (semua en). Pemeriksaan metadata sebelumnya salah menyaring forced. Kini semua pemeriksaan subtitle di PlayerScreen dan PlayerController menerima forced; isForcedSubtitleTrack mengenal kindforced secara eksplisit. Regresi memakai dataset perangkat asli, termasuk forced dapat dipilih dan timed metadata tetap hidup.
- Volume: detectDesktopSoftwareVolume mencoba dan memulihkan nilai hanya saat media paused/muted, sekali per elemen. Setter yang readonly menyembunyikan slider sebelum playback, tanpa mendasarkan keputusan pada user agent. Masih mempertahankan verifikasi write asinkron sebelumnya.
- Padding dikoreksi sesuai user: landscape daftar episode/stream kiri12px, kanan0. Header memakai content-padding-right0 dan safe area; kiri dipertahankan.
- Skip intro/outro browser: satu tema sentuhan tanpa highlight TV akibat autofocus, ukuran/padding/radius sama saat kontrol terlihat dan tersembunyi. Progress dekoratif disembunyikan pada browser agar cocok dengan tampilan controls-visible; timer auto-hide tetap. Posisi mengikuti safe area lokal, raised di atas kontrol. CardNext memakai orientasi canvaslokal, widthmin340px/lebartersedia, bukan mediaquery portrait fisik; raised bottom tetap di atas kontrol.
- Verifikasi Chrome dengan renderer asli dan data contoh pada tab lokal276727365: canvas844x390 ketika device390x844 (+90) maupun844x390 (native), CardNext340px pada keduanya. SkipIntro width119,height40,font14,radius12,bg rgba30/30/30/.85 identik dengan controls terlihat/hidden (sameAppearancetrue); varianOutro sama komponen. Safe area buatan47top/34bottom pada rotated canvas menghasilkan skipleft59 (=47+12), NextRight50 (=34+16), NextWidth340. Padding list terukur kiri12/kanan0. TextTrack Chrome asli dengan addon sebelum builtin: builtinStillListedtrue, selectedCountWithAddon1, canSelectBuiltinAgaintrue. Ini uji renderer/track API, BUKAN bukti embedded subtitles Safari dirender Chrome.
- Screenshot: player-skip-next-layout-check.png di folder visualisasi sesi, jelas berlabel data contoh, bukan pemutaran video. Tab uji ditutup. Cleanup CDP sempat auto-reviewtimeout90s (bukan rejection unsafe), retry sekali high-level close berhasil; menutup tab membuang seluruh override DOM/emulasi/cache lab. Tidak meninggalkan override di tab utama.
- Percobaan mengimpor PlayerScreen langsung di tab lab menemui siklus router ESM (Cannot access PlayerScreen before initialization); BUKAN error app.bundle produksi. Pengujian renderer kemudian memakai body metode asli diekstrak, dengan data contoh; module orientasi asli diimpor langsung. Jangan memperluas scope memperbaiki import lab ini.
- Fullscreen iOS tetap jalur webkitEnterFullscreen pada video; tidak diganti engine. Addon native <track> WebVTT bisa diuji di sistem player, sedangkan overlay HTML, drawer Sources/Episodes, dan tombol Skip custom tidak ikut native fullscreen. Jangan menjanjikan semua format/versi iOS menampilkan addon sama persis. User bertanya kemampuan, belum mengizinkan alur/setting native-player baru.
- Gates final:1431 tests pass, ESLint targeted pass, JS Prettier pass, build8d4102346f49, HTTP200. Belum commit. Posisi pixel subtitle builtin di iPhone masih menunggu konfirmasi visual; data cuecenterauto sudah ada dan intervensi layout dari JS dihapus.

## 42. Probe Unknown sesudah restart: lingkungan executable pulih (2026-10-25)

- User melaporkan semua Unknown dan internet lambat. Health saat diperiksa: oktrue, requests35/failures35/misses0, negativeSize12; stderr setiap probe failed3-4ms, bahkan github.com. Probe featuretrue; kegagalannya bukan disabled flag.
- Akar masalah yang dikonfirmasi: restart server pada section41 tidak meneruskan FFPROBE_PATH (juga FFMPEG_PATH serta anggaran/TTL runtime terdokumentasi). ffprobe tidak tersedia di PATH. Handoff section8 sudah mencatat executable Jellyfin; file keduanya terbukti ada dan ffprobe-version7.1.4-Jellyfin berjalan. Ini kelalaian restart agen, bukan bukti internet pengguna penyebab35kegagalan itu.
- Server PID18196 yang dimiliki sesi ini diverifikasi commandline-nya lalu dihentikan; diganti PID2652 dengan WindowStyleHidden. Lingkungan dipulihkan PERSIS section8: FFPROBE_PATH=C:/Program Files/Jellyfin/Server/ffprobe.exe, FFMPEG_PATH=.../ffmpeg.exe; PROBE_ENABLEDtrue, REMUX_ENABLEDfalse, TRANSCODE_ENABLEDfalse, PROBE_PAGE_LIMIT20, PROBE_TTL_MS86400000, PROBE_DAILY_BYTES42949672960, MAX_CONCURRENT8, RATE_LIMIT120. NUVIO_SUBTITLE_DEBUG1 tetap dipertahankan untuk diagnosis iPhone.
- Log aktif kini %TEMP%/nuvioweb-movi-probe-restored.log dan nuvioweb-movi-probe-restored-error.log. Log native subtitle sebelum restart tetap tersimpan pada file section41; untuk sampel baru baca stderr section42.
- Bukti endpoint nyata TANPA bergantung internet: Node HTTP fixture sementara bind127.0.0.1 portacak menyajikan file dual-audio-51-first.mp4 yang sudah ada di _spike-movi. GET/api/probe terhadap URL fixture menghasilkan HTTP200/oktrue, MP4/HEVC hvc1/AAC 6ch+2ch/640x360/20s, proses72ms. Server fixture langsung ditutup. Health sesudahnya requests1,misses1,failures0,negativeSize0,cacheSize1; TTL dan budget sesuai konfigurasi pulih. Anggaran virtual terpakai10MiB dari satu uji fixture; bukan download internet.
- Restart membuang negative-cache backend dari35gagal sebelumnya (tidak ada positive-cache media pengguna saat restart). Frontend menahan failed-set perhalaman; minta reload halaman stream sekali agar Unknown lama dicoba lagi. Prober JS hanya mencache hasil sukses, bukan null. Tidak menghapus cache/profil secara tambahan, tidak mengubah setting labeling/direct/HDR, tidak mengubah kode produk atau build. Koneksi CDN nyata masih bisa lambat terpisah; uji ini membuktikan executable/bridge sudah bekerja, bukan bahwa seluruh sumber internet sudah pulih.
- PENTING: jangan menjalankan Start-Process node scripts/serve.mjs dengan lingkungan kosong lagi. Selalu set lingkungan startup section8 dan debugflag jika diperlukan, atau kembalikan launcher yang membawa nilai tersebut. Belum commit; build tetap8d4102346f49.

## 43. iPhone nyata tersambung melalui Inspect CLI (2026-10-25)

- User telah menyalakan Web Inspector, membuka movi di Safari, dan menyebut pernah Trust komputer. Awalnya Windows PnP mendeteksi Apple iPhone/USB, Apple Mobile Device Service Running, tetapi Inspect doctor menyatakan usbmuxd tidak menemukan device. Setelah pengecekan ulang kini device USB reachable/isPaired/statusready, iOS26.3; tidak perlu reset trust atau instal ulang driver.
- CLI resmi dari panduan inspect.dev/agent.md: @inspectdotdev/cli versi3.3.2, dijalankan lewat npx (bukan instalasi global). Prefix cepat tanpa mengunduh ulang: npx --offline --yes @inspectdotdev/cli@3.3.2 --no-telemetry. Jangan menjalankan foreground inspect server tambahan; typed commands memakai daemon sendiri.
- devices list dan targets list berhasil. Target yang dipilih HANYA WIRTypeWebPage pada https://movi.alphasquare.my.id/ dalam Safari (bukan ServiceWorker atau situs lain). targets use berhasil pada sessiondefault. ID perangkat/target tidak ditulis di chat/handoff; data lokal mentah tersedia di %TEMP%/nuvio-inspect-devices.json, nuvio-inspect-targets.json, nuvio-inspect-attach.json. Pilih target berdasarkan url+type sebelum menggunakan id, jangan mengarang id.
- snapshot --interactive --json berhasil membaca Safari iPhone secara langsung: title Profiles-Nuvio, Who's watching?, AddProfile, Manage, SignOut. Output lokal %TEMP%/nuvio-iphone-snapshot.json. Kartu profil div tidak muncul pada snapshot interactive; jangan menyimpulkan profil tidak ada. Belum memilih profil/memainkan video lewat Inspect, belum mengambil screenshot atau membaca runtime video langsung.
- Capabilities target: evaluate/console/network/screenshot/domSnapshot/browserInteraction/rawCDP true, nativeInputfalse (inputsynthetic). Jangan menjanjikan kendali UI sistem/native fullscreen. PWA Home Screen belum dipastikan targetnya; saat ini Safari biasa.
- Paket gratis menurut vendor dua sesi15menit/hari; devices/targets discovery/doctor/agent-context tidak memakai sesi, targetsuse/snapshot sudah memulai sesi metered. Jangan membeli/upgrade/login/sendfeedback tanpa instruksi user. Rawdata perangkat disamarkan saat output; hanya target domain Nuvio ditampilkan. Server/probe dari section42 tidak disentuh dan tetap diperlukan.

## 44. Uji terbatas posisi subtitle native Silo (2026-10-25)

- User mengonfirmasi tautan MP4 yang dibuka langsung di Safari (tanpa Nuvio) juga menampilkan subtitle di kanan. Ini membuktikan gejala dapat terjadi tanpa Nuvio; belum membuktikan akar masalah file vs iOS.
- ffprobe pada sumber Silo S2E3: MP4 1325401403 bytes, duration3269.690, H2641920x804, AC3, dua mov_text Inggris. Metadata moov diambil via Range206 sebanyak2105426 bytes. Kedua tx3g horizontalJustification1/verticalJustification-1 (tengah bawah), BoxRecord0, track width/height0, matriks identity. Nilai BoxRecord0 juga dipakai encoder FFmpeg, jangan disebut bukti file rusak. Sampel paket sampai31.198s tidak berisi override posisi. URL berisi kredensial tidak disalin ke handoff atau kode.
- Dengan persetujuan user dibuat eksperimen sementara, default OFF: env NUVIO_NATIVE_SUBTITLE_CENTER_TEST_VIDEO diekspos sebagai global **NUVIO_NATIVE_SUBTITLE_CENTER_TEST_VIDEO**. Hanya browser dengan params.videoId identik dan track native subtitles/captions/forced (bukan externalTrackNodes addon) yang ikut.
- applyNativeSubtitleCenterTest hanya activeCues: snapToLinestrue,line-1,lineAlignend,position50,positionAligncenter,aligncenter; setter hanya saat nilai berbeda dan tahan readonly. Jalur ini melewati applySubtitleCueDelay sehingga start/end native tidak ditulis. Pengaturan CSS ukuran/warna/dll dan offset container yang sudah ada tetap berjalan. Ini eksperimen untuk diagnosis, BUKAN bukti visual perbaikan atau kebijakan permanen semua subtitle.
- Devserver dihidupkan dengan semua env probe section42 dan NUVIO_SUBTITLE_DEBUG=1 serta NUVIO_NATIVE_SUBTITLE_CENTER_TEST_VIDEO=tt14688458:2:3. PID20688. Stdout/stderr tetap nuvioweb-movi-probe-restored*.log dalam TEMP. Untuk mematikan eksperimen restart tanpa env center-test, buka ulang playback agar cue lama tidak tersisa.
- Gates:54 targeted tests pass;1434 full tests pass; ESLint targeted pass; JS Prettier pass; build0a5717c6d328; diff-check clean. Pengguna perlu reload aplikasi, buka Silo S2E3 sumber1.23GB yang sama, pilih Built in English, amati sekitar19-40s: tengah vs kanan, hilangnya dialog lama/stacking; lanjut tes ukuran/warna/bold/offset. Safari inline dulu, native fullscreen terpisah. Belum commit.

### 44.1 Hasil iPhone dan uji kedua

- User: portrait tengah tetapi di atas gambar; tidak ada dialog lama bertumpuk. Landscape (canvas fallback diputar saat HP portrait) tidak terlihat. Log mengonfirmasi native track tetap showing, position50/aligncenter/line-1/snapToLinestrue. Ini bukan bukti track mati; belum terbukti penyebab teks di luar frame.
- Uji kedua hanya mengganti posisi vertikal eksperimen menjadi line95/snapToLinesfalse (persentase) dari line-1/snapToLinestrue (baris). Timing tetap tidak disentuh. Offset container/pengaturan pengguna belum diubah. Diagnostic sekarang memisahkan preference/rotation dalam key, menambahkan userOffset/nativeOffset/rotation agar portrait tidak tertutup dedup log landscape.
- ffprobe dua stream mov_text berbeda dengan daftar Safari: log native memiliki empat objek [subtitles,forced,subtitles,forced]. getVideoTextTrackList membaca video.textTracks langsung dan getTextTracks mengonversinya ke array, bukan menggandakan menjadi4. Belum membuktikan pemetaan isi dua forced ke stream MP4, jangan sebut4 konten independen atau hapus2 berdasarkan jumlah.
- 42 mobileUx tests pass, ESLint pass, build7174e1da5c3a. PublicHTTP200, center-test masih terkonfigurasi. Tidak restart devserver, tidak commit. User perlu keluar playback/reload lalu uji sumber/track yang sama dalam portrait dan landscape, kontrol muncul/tersembunyi.

### 44.2 Hasil uji persentase dan syarat lintas perangkat

- User: portrait sudah baik; landscape canvas fallback teks terlihat tetapi melayang, naik lagi saat kontrol tampil. Screenshot landscape berasal dari HP portrait dengan canvas rotate90.
- Log: landscape rect754x316 x0/y49, rotation90, userOffset5 (default), nativeOffset0px saat controlsfalse dan -53px saat controlstrue; cue line95/snapToLinesfalse/position50/aligncenter. Portrait rect414x173 x0/y290, rotation0, offset0px. Satu track showing. Gejala melayang saat kontrol tersembunyi tidak dijelaskan oleh lift kontrol karena nilai offset0px. Belum membuktikan bagaimana compositor native menghitung geometri setelah CSS rotate.
- User menegaskan perbaikan akhir harus lintas perangkat, bukan khusus iPhone miliknya. Gate episode hanya untuk eksperimen sementara; kebijakan final harus capability/geometri tanpa offset angka khusus model/UA, dengan regresi portrait, native landscape dan canvas rotate kedua arah.
- Pemeriksaan pembeda berikutnya: sumber/track sama, HP benar-benar landscape (canvas rotation0) vs HP portrait/player landscape (canvas rotation90). Jangan menebak koreksi vertikal tambahan sebelum pembanding ini. Pada turn ini tidak ada perubahan kode/build.

### 44.3 Pembanding fisik landscape dan uji renderer rotasi

- User memastikan fisik HP landscape subtitle sudah di bawah. Bersama log44.2, gejala melayang terbatas pada fallback CSS rotate; jangan koreksi semua landscape atau pakai offset model iPhone.
- Uji episode masih gated defaultoff. syncRotatedNativeSubtitleTest memakai node khusus playerNativeSubtitleTest (bukan overlay addon), hanya saat browserOrientation.rotated + native track showing yang lolos gate, bukan addon, bukan nativeFullscreen. Track tetap showing agar native activeCues dan pilihan track tetap dimiliki browser. Native cue display disembunyikan via class CSS hanya saat mirror aktif; mode/waktu track tidak diubah.
- Dialog dirender dari track.activeCues saat cuechange/timeupdate, dibersihkan jika kosong/off/addon/portrait/fullscreen. Teks diproses parseSubtitleCueText lalu textContent, bukan innerHTML. Tidak membangun timeline salinan dari endTime provisional Safari. Node mengikuti playerLocalRect(video) untuk rotate+90/-90; garis dasar5% dari bawah rect video, memakai offset container yang sama (pengaturan pengguna+overlap seekbar). Ukuran font relatif tinggi video dan fontSize setting; warna/bold/shadow/latar diwariskan dari variabel subtitle existing. Belum mengklaim visual iPhone lolos.
- Update dipanggil ketika viewport/control offset berubah, style refresh, dan timeupdate. Portrait/fisik landscape/native fullscreen memakai jalur native uji95% sebelumnya. Subtitle addon memakai renderer existing.
- Gates55 targeted,1435 full pass; ESLint pass; build berhasil. User perlu reload/buka ulang sumber Silo S2E3 sama lalu uji HP portrait/player landscape, kontrol hidden/shown, pergantian dialog, dan kembali portrait. Belum commit; setelah lolos baru pertimbangkan kebijakan umum berdasarkan kemampuan browser/layout (syarat user lintas perangkat).

### 44.4 Empat pilihan Built in: investigasi belum selesai

- User meminta masalah4 kartu tetap ditangani. File moov lokal diperiksa lebih jauh: dua trak sbtl masing-masing mempunyai udta/name English dan English [SDH]. Tidak ada atom tref pada dua trak tersebut; track atoms [tkhd,edts,mdia,udta]. Ini bukti2 subtitle fisik berbeda, bukan salinan identik. Jangan menggabungkan berdasarkan bahasa.
- Native Safari yang tercatat sebelumnya [subtitles,forced,subtitles,forced]. WebKit processMediaSelectionOptions membuat InbandTextTrack dari AVMediaSelectionOption yang dilaporkan AVFoundation; kind forced berasal characteristic ContainsOnlyForcedSubtitles. Ini menjelaskan sumber jenis entri, belum membuktikan pemetaan empat opsi file ini atau bahwa forced kosong.
- Inspect targets list saat ini tidak menemukan halaman Nuvio. User diminta via async menyambungkan USB dan membiarkan player Silo terbuka untuk pembacaan identitas dan metadata native. Belum ada perubahan kode untuk mengurangi jumlah kartu. Jangan menghapus semua forced, menyamakan same-language sebagai duplicate, atau klaim selesai.
- Sumber resmi diperiksa: WebKit MediaPlayerPrivateAVFoundationObjC.mm processMediaSelectionOptions, InbandTextTrackPrivateAVFObjC.mm kind/label/containsOnlyForcedSubtitles, Apple AVMediaCharacteristicContainsOnlyForcedSubtitles dan AVTrackAssociationTypeForcedSubtitlesOnly.

## 45. Root investigation native forced-only options and manual menu repair (2026-10-25)

- User required investigate why Safari exposes4 before filtering. Prior source-inventory/probe filtering was never built/deployed and was removed; services/probe-bridge/bridge.mjs and js/core/player/streamProbe.js have no new diff. Do not reintroduce metadata probing merely to count subtitle cards.
- Direct Inspect on authorized Safari Silo page read4 native tracks, all label empty, ids0..3: [subtitles en,forced en,subtitles en,forced en], no DOM <track> ownership. Not Nuvio-created addon duplicates. First reading currentTime239.233/pausedtrue. No unrelated phone pages read.
- Auto approval initially rejected mutation for switch/seek because initial request said no subtitle change; user explicitly authorized via async subsequent switch-all/seek/restore. Inspection saved original state on window.__nuvioTrackAudit, compared dialogue19.2s. First brief attempts before demux readiness did not provide valid normal-track samples; do not infer empty from that. After readyState4+two-phase disable/select, native0 gave22char dialogue hash685160615 and native2 gave33char hash1004206453 (matches source normal vs SDH distinction). Forced1 and3 had0 cues for same loaded interval. This does NOT establish forced empty for whole episode by scanning all frames. Modes/time/paused restored, audit variable deleted: time239.236920416 pausedtrue modes[showing,disabled,disabled,disabled]. Local redacted/fingerprint-only result in TEMP/nuvio-iphone-subtitle-audit-result.json (raw CLI envelope includes device IDs, redact if displaying).
- Key official finding: Apple AV Foundation Release Notes, Advice about subtitles, https://developer.apple.com/library/archive/releasenotes/AudioVideo/RN-AVFoundation/ lines66-73: legible options represent full elective+essential content and essential-only (forced-only). Apple advises excluding forced-only from normal manual language selection and preserving for automatic essential-caption handling. WebKit CaptionUserPreferencesMediaAF.cpp sortedTrackListForMenu also excludes containsOnlyForcedSubtitles for ordinary caption menus (manual-caption display mode has an exception). MediaPlayerPrivateAVFoundationObjC.mm processMediaSelectionOptions exposes AVFoundation options as native tracks, kindForced is mapped from characteristic. Distinguish these documented facts from unproven internal closed-source AVFoundation synthesis mechanism for this exact asset.
- No public JS API found to disable creation/remove native inband options; .mode changes state only. Four options do not prove four physical streams or malformed file. Nuvio menu previously mirrored raw collection; missing distinction between system forced-only choice and full subtitles is the fixable consumer-layer issue. No need to rewrite media/transcode/remux or suppress all forced content.
- Added getSubtitleMenuOptionItems(): browser manual menu excludes unselected INTERNAL track.kind===forced when a full non-forced native subtitles/captions option with SAME normalized known language exists. Preserve selected forced (so active setting remains visible), lone forced, unknown-language forced, explicit named/flagged forced with normal kind, addon, HLS/DASH options, TV. No user-agent/device-model condition.
- Only getSubtitleLanguageRailItems and getSubtitleOptionsForLanguage consume manual list; collectSubtitleOptionItems/getSubtitleEntries remain raw for automatic startup/forced preferences and original indices. No changes to track.mode/timing, no probe calls. Two Silo ordinary cards retain indices0 and2, selected state preserved.
- Tests:45 targeted mobileUx pass,1437 full pass, ESLint/JS Prettier pass, build success, diff-check clean. No new iPhone visual verification because latest targets query found no Nuvio page; user can reload/reopen menu to verify two manual Built in choices. Existing Silo subtitle positioning experiment remains active. No commit.

## 46. Subtitle native umum dan investigasi startup Project Hail Mary (2026-10-25)

- User mengonfirmasi2 kartu tambahan sudah hilang,2 subtitle berisi tetap ada di Silo/sumber lain; pengaturan size/color/bold/background/offset sudah diuji berhasil. PiP iPhone dilaporkan hanya berhasil browser; jangan klaim PWA PiP selesai. User meminta generalisasi posisi builtin, kemudian ffprobe dan remux.
- Gate judul Silo dan global **NUVIO_NATIVE_SUBTITLE_CENTER_TEST_VIDEO** DIHAPUS dari kode/runtime. Nama produksi: isBrowserNativeSubtitleTrack, applyBrowserNativeSubtitleLayout, syncRotatedNativeSubtitles; node playerNativeSubtitles, uiRefs.nativeSubtitles, CSS player-native-subtitles*. Browser native subtitles/captions/forced eligible pada semua judul; addon identity dikecualikan, TV tidak diubah. Rotasi canvas memakai overlay activeCues yang sudah diuji; portrait/fisik landscape native95% tengah bawah. Pengaturan existing tetap berlaku. Native timing default tidak ditulis jika tidak perlu; delay nonzero/resetzero tetap memakai applySubtitleCueDelay dan mengikuti update demuxer. Tes baru membuktikan generalisasi lintas judul serta delay/reset. User sudah memverifikasi gaya/posisi pada eksperimen; generalisasi kode baru belum uji visual semua perangkat.
- Error pengguna: PWA iPhone, Project Hail Mary AIOStreams1080p2.79GB, kartu yang persis sama dicoba3kali; dua percobaan pertama menunjukkan reasonstartup-stall, readyState0/networkState2/statusHTTPunavailable. Keduanya jenis error yang sama, bukan bukti codec/HTTPerror berbeda. Code getPlaybackStallTimeoutMs startup18000; guard gagal sebelum metadata. playStreamCandidate memberi URL HTTP langsung ke mediaelement (generic302 ditangani browser), resolver APIdebrid khusus hanya jika URL kosong.
- User mengirim URL Torrentio resolve/alldebrid untuk torrent hashffd0888d79ee2a493bd37e8ab6844acc42c30124, file Project.hail.mary.2026.1080p-dual-lat-cinecalidad.rs.mp4. URL mengandung APIkey: JANGAN salin ke handoff/log/diff/final. Audit HTTP dari Windows dengan Range0-1023: Torrentio302661ms -> 8sio2e.debrid.it2061687ms;1024bytes, ContentRange0-1023/2996240426, ContentTypeapplication/octet-stream, prefixMP4ftypmp42. Berhasil saat diuji; bukan bukti kondisi cold request iPhone sebelumnya sehat.
- ffprobe actual URL sukses4898ms tanpa stderr: MP4duration9382.4,size2996240426,H264Highavc11920x1080,duaAACLCstereo,dua mov_text1920x162. Bukan file otomatis perlu remux hanya karena berkasmp4/CDNtypeoctet-stream. Belum ada perubahan timeout, resolver atau autoretry; akar kegagalan PWA awal BELUM dikonfirmasi.
- Inspect melihat Safari Select Stream - Nuvio, tetapi snapshot/network ditolak SUBSCRIPTION_REQUIRED: dua free debug sessions harian15menit habis, nextAvailable2026-10-25T17Z=26Oct00:00Asia/Bangkok. Tidak login/beli/upgrade/mengakses rawCDP untuk melewati batas. User diberi penjelasan bahwa ini limit Inspect, bukan Nuvio/Codex. Tidak menekan sumber pada percobaan ini. PWA awal berbeda konteks dari Safari diagnostik, jangan samakan bukti.
- Ditambah diagnostik aplikasi sendiri yang independen dari Inspect dan defaultOFF: env NUVIO_PLAYBACK_STARTUP_DEBUG=1 -> global **NUVIO_PLAYBACK_STARTUP_DEBUG**. startPlaybackStartupDiagnostics dipasang sebelum PlayerController.play; maksimal24media events,progresspertama saja,TTL90s, maksimal5laporan unik per source; eventloadedmetadata/canplay/error + showStartupError reason. Eventlisteners dilepas pada source berikutnya/unbind. Log ke endpoint existing/api/debug/log, hanya host,timestamp,standalone via isAppInstalled,elapsed,ready/network/errorcode,mediaeventtimings. Tidak mencatat URL/token/title/dialog, tidak mengganti mode/media timing, pause,seek,timeout atau retry. Tetap mendengar setelah startup-error untuk mengetahui metadata terlambat. Tes membuktikan optin,batas,privacy,metadata23ssetelah error18s,cleanupdanmediastatetidakberubah.
- DevserverPID24384, flagsprobe section42 dipertahankan, NUVIO_SUBTITLE_DEBUG=1 dan NUVIO_PLAYBACK_STARTUP_DEBUG=1 aktif sementara. Log stdout/stderr nuvioweb-movi-probe-restored*.log, salinan stderr sebelumnya nuvioweb-movi-before-startup-debug-error.log. Gateeksperimenjudul tidak ada. Buildacf24cd31101;1439fulltests pass,ESLint/Prettier targeted pass,diff-checkclean,publicHTTP200/healthok.
- Langkah user berikutnya: reloadPWA,buka sumberHailMaryyangsama; jika error biarkan10s sebelum retry dan kabarkanhasil agar logstartupdibaca. Tidak perlu Inspect untuk ini. Jangan klaim rootcause selesai. Belum mengaktifkan remux, belum implementasi ffprobeWASM, belum commit.

### 46.1 Bukti PWA startup lambat (log pengguna 2026-10-25T11:17:03Z)

- Log console user memuat dua Playback source hosttorrentio.strem.fun pada11:15:58.205Z dan11:16:36.396Z. Log server mengonfirmasi dua attempt standalone=true.
- Attempt1 startedAt1792926958384: waiting62ms,loadstart189ms,stalled3354ms; startup-stall18074ms denganready0/network2/mediaErrorCode0. Metadata kemudian SUKSES27704ms (ready1),loadeddata29499ms (ready2),canplay29515ms (ready3),tetapmediaErrorCode0. Ini bukti sumber yang sama berhasil memuat metadata/data SETELAH Nuvio menampilkan error18s; bukan bukti file/codec ditolak. Error UI startup yang sudah aktif mengabaikan kelanjutan eventnormal (onLoadedMetadata/onCanPlay punya startupError guard), sehingga user membuka ulang.
- Attempt2 startedAt1792926996553: metadata1231ms,loadeddata3642ms,canplay3660ms;mediaErrorCode0. Bukti pembukaan kedua lebih cepat; alasan upstream27.7s pertama (redirect/debrid/CDN/jaringan) belum dipisahkan. Jangan klaim cache/provider pasti penyebab, jangan menambah generic resolve/retry tanpa bukti.
- User bertanya arti readyState0: HAVE_NOTHING,metadata belum tersedia,bukan HTTPstatus,errorcodec,atau filekosong. network2 berartiNETWORK_LOADING,mediaErrorCode0 tidak ada mediaerror browser saat Nuvio timeout.
- Perbaikan yang didukung bukti: pisahkan penantian sambungan/metadata dari penyangga playback18s dan cegah error terminal mengunci source yang masih memuat lalu siap. Belum diterapkan pada turn baca log ini; timeout tetap18/9. Log asli tetapdiTEMPnuvioweb-movi-probe-restored-error.log. Tidak commit.

## 47. Startup metadata deadline dan recovery (2026-10-25)

- User menyetujui perubahan setelah bukti46.1. Browser startup sekarang mempunyai state per source/mediaelement: startupReadiness{url,video,startedAt,metadataAt,timeoutError,allowPlayback}. Dimulai sebelum PlayerController.play; reset mount/unbind; TV tetap memakai jalur/budget startup18s sebelumnya.
- getPlaybackStallTimeoutMs: browser menunggu metadata maksimal60s sejak attempt dimulai; setelah metadata tersedia budget18s terpisah sejak metadataAt. Waiting/canplay/playing berulang menghitung SISA deadline, tidak memperpanjang terus. Playback yang sudah menyajikan frame tetap9s. Override guard/relay existing dipertahankan.
- noteStartupReadiness dipanggil loadedmetadata/canplay/playable/playing. Mencatat metadata pertama sekali, menjadwalkan ulang guard untuk tahap frame. Jika guard menemukan readyState>0 sebelum callbackmetadata tercatat, transisi fase dilakukan sebelum menilai stall. Guard menangkap URL dan identitas state sehingga callback attempt lama tidak menggagalkan source baru.
- showStartupError menandai timeoutError HANYA reasonstartup-stall tanpa mediaerror. Late native ready event memulihkan HANYA state/source/video yang sama, belumpresentedframe,ready>=1,mediaerror0; errorlain tidak dipulihkan. Clear startup error dan penanda failedURL/streamID, kembalikan loading dan gateaudio dengan allowPlayback asli, lalu eventloadedmetadata/playable menjalankan preferensi/resume/overlay existing. Tidak mengambil ulang URL, tidak mengganti source, tidak mengubah playerengine/resolve, tidak menambah retry jaringan.
- Regresi memakai timeline aktual:18.074s tidak gagal,metadata27.704s memberi deadlineframe45.704s,canplay29.515s tidak menggeser deadline. Sumbertanpametadata tetap timeout60s; errorcodec/source lama tidak pulih; gate/frame/backendaudio existing dipertahankan. Semua51mobileUX dan1443fulltests pass,ESLint/JSPrettier/diffcheckpass.
- Buildddaa00aaf626. PublicHTTP200,appbundle terverifikasi berisi noteStartupReadiness,probehealthok. Tidak restart backend (staticdist diperbarui),PID24384/configprobe+startupdiagnostic sementara tetapaktif. Tidak reset cache, tidak mengubah profil, belum commit. User perlu reloadPWA dan mencoba sumberHailMary2.79GB sama; logserver tetapdiTEMPnuvioweb-movi-probe-restored-error.log untuk verifikasi aktual setelah patch.

## 48. Penutupan pekerjaan player dan commit (2026-10-25)

- User mengonfirmasi perbaikan startup aman dan mengizinkan menonaktifkan diagnostik lalu commit seluruh perubahan player yang terkumpul sejakbf54531e. Generalisasi subtitle, dua kartu manual Built in, dan pengaturan gaya/posisi sudah diterima pengguna; jangan tandai seluruh pengujian lintas platform/PWA PiP selesai.
- Devserver direstart tersembunyiPID19444 dengan NUVIO_SUBTITLE_DEBUG=0 dan NUVIO_PLAYBACK_STARTUP_DEBUG=0; runtime publik mengonfirmasi kedua globalfalse,HTTP200,probehealthok. Konfigurasi ffprobe/probe section42 tetap,REMUX_ENABLED=false,TRANSCODE_ENABLED=false. Kode debug optin/defaultoff tetap tersedia; tidak menghapus kemampuan logging standar aplikasi. ReloadPWA diperlukan agar session yang masih terbuka mengambil konfigurasi runtime baru.
- Bukti log sebelumnya disimpan TEMP/nuvioweb-movi-startup-debug-completed-error.log. Stdout/stderr aktif tetapTEMP/nuvioweb-movi-probe-restored*.log. Restart normal mengosongkan cache probe backend in-memory; tidak menghapus data profil/pengaturan/cache browser.
- Validasi produk terakhir:1443tests pass,buildddaa00aaf626. Lint semua JSyangakancommit dicek lagi danlulus;diff-checkclean. Commit mencakup14berkas:toolbar/orientasi/gestur/mobileUI,subtitlelayout/seleksi/menu,metadata startup/recovery,tests,rotateicon,diagnostikdefaultoff,catatanhandoff. Tidak push.
- Berikutnya sesuai urutan user: ffprobe browser/WASM lalu remux. Uji binaryffprobe pada sumberHailMary sudah berhasil; belum menambahkan WASM atau mengaktifkan remux. Filter/sorting connected server masihtidakdiubah. PiP PWA belum dinyatakan bekerja.

## 49. Opsi hoster ffprobe server/client/off (2026-10-25)

- Permintaan user: hoster memilih probe sisi server, client, atau mematikan keduanya. Implementasi PROBE_MODE=server|client|off, defaultserver. PROBE_ENABLED=false tetap menjadi legacyoff jika mode tidak eksplisit; mode tidak valid menjadioff. Node runtime, build/local.properties, dan Docker entrypoint menerapkan kontrak yang sama. Client/off mematikan endpoint Node dan mengosongkan endpoint publik; tidak ada fallback client ke server.
- Client memakai @ffmpeg/core0.12.10 single-thread ffprobe asli dalam Worker, bukan heuristik ekstensi. Binary sekitar31MiB sebelum kompresi, aset lokal di dist/assets/libs/ffprobe, dimuat malas hanya setelah sumber lolos preflight CORS/Range. Tidak ada SharedArrayBuffer atau perubahan COOP/COEP. NOTICE/COPYING disertakan; dokumentasi hoster docs/probing.md.
- Baca sparse file melalui HTTP206 Range256KiB, Content-Range wajib terlihat lewat CORS, maksimal8MiB media per percobaan. Ukuran file tidak mengalokasikan buffer penuh. Respons200 yang mengabaikan Range dibatalkan sebelum body dibaca. URL akhir redirect dipakai ulang, cookies diabaikan, modul tidak mencatat URL atau meneruskannya ke server Nuvio. CORS/Range gagal menghasilkan unverified/null, tanpa serverfallback.
- Satu Worker/antrian bersama untuk semua pemanggil; timeout existing mencakup antrian/download core/probe. Worker dihentikan saat error/timeout dan setelah30detikidle. Coldload lambat bisa tetapUnknown. Metadata normalizer server/client dibagi menjadi probeMetadata.js; assessment codec/HDR/perangkat tetap existing. Detail/autoplay/streamlist/player memakai mode deployment sama. Tidak mengubah sorting/filter atau mengaktifkan remux/transcode.
- Bukti:1457fulltests pass, build0c34b6f5ab4c. Uji ffprobeWASM asli Node dan Chrome terisolasi (crossOriginIsolatedfalse): MP4 sparse virtual>3GiB terbaca dengan266815byte media, MKV terbaca, AVC/audio5.1+stereo benar. Off tidak memuat Worker/core; client tidak memanggil endpoint server. Kasus CORSditolak, Content-Range tersembunyi, Range diabaikan gagal tanpa fallback. Uji runtime Node server/client/off dan shell Docker server/client/off/legacyFALSE/invalid lolos. Fixture sintetis kecil milik proyek, bukan video pengguna.
- ESLint lulus untuk seluruh berkas JS berubah/baru selain streamScreen.js yang masih mempunyai3 unused import tracePlayback/traceUrlKind/traceHost dariHEAD sebelumnya; tidak diubah. Diffcheckbersih. Belum menguji WASM aktualiPhone/TorBox atau menyatakan semua provider memenuhi CORS. Jangan klaim ujiChrome sebagai buktiiOS. Tidak reset pengaturan/cacheprofil pengguna.
- Devserver direstart tersembunyiPID16020, PROBE_MODE=server; konfigurasi ffprobe dan batasprobe sebelumnya dipertahankan. REMUX_ENABLED=false,TRANSCODE_ENABLED=false,dua diagnostikfalse. Local/public runtimeHTTP200,probehealth200,MIMEWASMapplication/wasm. Restart mengosongkan cacheprobe backend in-memory. Log tetap TEMP/nuvioweb-movi-probe-restored*.log. Belumcommit pekerjaanWASM ini; commitplayer sebelumnya12d3dfe5.

### 49.1 Uji client di deployment aktif

- User meminta mencoba probeclient. Devserver direstart tersembunyiPID20632 dengan PROBE_MODE=client. Pengaturan ffprobe/limits lain dipertahankan, remux/transcodefalse, diagnostikfalse. Publicruntime diperiksa client dengan PROBE_ENDPOINTkosong, endpointprobeNode404, asetWorkerpublik200. Tidak menghapus cache/pengaturanprofilbrowser. User perlu reload/reopenPWA agar mengambil modebaru; coreWASM dimuat malas saat probesumberpertama.

### 49.2 TorBox/StremThru: client murni dan ukuran dari HEAD

- User menolak bantuan server untuk resolve: modeclient harus sepenuhnya browser walaupun sebagianaddon tidakbisa. Tidak menambahkan bridge/proxy/fallbackserver baru. Existingdebridresolver memakai serverbridge dan API TorBox direct diblokirCORS (dibuktikanChrome requestdlJSON dan mylist); jangan memakai resolveritu diam-diam untukprobeclient.
- Uji linkTorrentioTorBox: Torrentio302 CORS*, api.torbox.app307 tanpaACAO, CDN206 mengizinkanorigin. Chrome berhenti diAPITorBox. LinkStremThru user berbeda: StremThru302 CORS* langsungCDN206 denganACAOorigin, sehingga seluruhredirect lolosChrome. Jangan menulis URL/tokenprivat ke trackedfile atau laporan.
- CDN menyembunyikanContent-Range tetapi HEAD dariChromeHTTP200 menampilkanContent-Length2525414437. Reader kini memakai HEAD CORS credentialsomit keURLakhir hanya jika206 tidakmemperlihatkanContent-Range. UkuranHEAD wajib positif/safeinteger/status200 dan finalURLsama; tiap206 wajibContent-Lengthtepat sesuai rentang yangdiminta/clampukuranfile. HeaderContent-Range yangada tetapdivalidasi, tidakditimpaHEAD. Tidak mengira ukuran dari labeladdon atau filebuffer. HTTP200untukGETtetapditolak sebelumbody; budget8MiB/timeout tetap.
- Uji ffprobeWASM aktualChrome darioriginpublic denganlinkStremThru user lolos dalam2576ms pada deadline8detik: MP4 AVC1920x1036,AC3eng6channels,durasi9391.8s. TotalGETparsialuji4113447bytes termasukduaGET1byteverifikasi; tidakdownload2.5GB. TidakadaerrorCORS dan tidakadapanggilanprobe/resolveNuvioserver. Nodeheaderinspectionhanyaalatdiagnostik, bukanbagianruntimebrowser. BelummengklaimiPhoneaktual.
- Tambah3regresirangeHEAD: sukses/lastchunk, CORS/ukuraninvalid/URLbeda/statusinvalid, partiallengthtidaktepat. 12targetedpass,1460fullpass,lintreader/testsdan diffcheckpass. Build97cbddb254a5 sudahdisajikandevserverPID20632;runtimepublikclient,endpointkosong. Dokumendiperbarui. Tidakrestart/cacheclear/commit. PenggunaperlureloadPWA/app lalu cobaStremThruyangsama. Torrentio/AllDebrid sebelumnya masihterhambatCORS; penyesuaianHEADtidakmembuka izinCORS yangtidakada.

### 49.3 Unknown iPhone belum terbukti; serialisasi caller dan diagnostik opt-in

- User melaporkanSafari/PWA masihbanyakUnknown termasukStremThruyangsama. Jangan menyatakanCORS/codec sebagai penyebabspesifik perangkat tanpa logiPhone. Kode membuktikanhalaman mengirim5probesekaliguskeWorkerserial sementara15detikdeadlineberjalan sejakenqueue; kandidatbelakangan bisaexpire sebelumdiperiksa. Clientcaller kini1pergiliran dihalamanstream/panelplayer/detailautoplay (serverbatchtetap). HDRpriority/addonscope/pagecap tetap; FIRSTSTREAMurutankandidat tetap. Pemanggilprobeclient tidakmemakai existingserverdebridresolve untuk rowtanpaURL. Autoplayselectiondeadline keseluruhan tetapdihormati.
- RegresibrowserStreamScreen client dengan8sumber mengonfirmasi pendingmaksimal1 danurutanURLpersis sama. 41targetedawallulus; diagnostiktests baru memverifikasiqueue-timeout vs timeout, stageworker/WASM/metadata, flagdefaultoff dan takadaURL/token/exceptionmessage dalamlog. Total1463fulltests pass,lintchangedJS pass kecualiunusedimportstreamScreen sebelumnya. Diffcheckpass.
- User mengizinkan diagnostik jika penyebabiPhone belumdiketahui. Tambah **NUVIO_CLIENT_PROBE_DEBUG** opt-in/defaultoff lewat env NUVIO_CLIENT_PROBE_DEBUG=1 diNodehost. Hanya console.warn[ClientProbe]lokalclient, tanpatelemetryserver/URL/host/token. Eventqueued/start/stage/success/failure/unsupported denganid,queuedMs,elapsedMs,stage,reason,workerStarted,ranges,mediaBytes,fileBytes,codecmetadata. Stagecore-script/wasm-loading/metadata danrange memisahkan coldload,network,ffprobe. Jangan menulisnativeerrormessage yangmungkinmengandungURL. Diagnostiksubtitle/startup lamamasifalse.
- Build69c4bd15c07c. Devserverdirestart hiddenPID10828 modeclient denganNUVIO_CLIENT_PROBE_DEBUG=1; publicruntimeclient+endpointkosong+clientdebugtrue terkonfirmasi. Worker nyataChrome denganStremThrusama lolos2947ms,16ranges4113445byte, stagewasm-loading617ms/metadata2231ms; logdiagnostikberfungsi. Ini bukanbuktiSafari. Userperlu reload/reopenPWA cobajudul/sumberyangsama tungguprobe laluSettings>About>Consoledebug>Copylog dan kirim untuk diagnosisaktual. Belumcommit/cacheclear. SetelahpenyebabiPhoneberes matikanclientdebugsepertiusersebelumnya meminta diagnostikoff.

### 49.4 LogSafari: gagal sebelumWorker, perlu statusrespons

- User mengirim log2026-10-25T12:47:42Z (64events,buildtimestamp12:44:45,userAgentMacintoshSafari). Semua20probe gagal dalam3–1094ms, queuedMs0–1, workerStartedfalse,ranges0,mediaBytes0,fileBytes0. Mayoritasreasonprobe-range-or-cors-unavailable, sisanyasource-or-worker-failed. Ini membuktikangagal tahapHTTP/validasirange sebelumcoreWASM; bukanantreantimeout15detik/ffprobe/decoding. LogbelummembedakanHTTP200,headerinvalid/hiddenatauTypeErrorCORS, janganmenetapkanpenyebabfinal.
- Tambah snapshotdiagnostikreader (tanpaubahalgoritmefetch): request range/head,start/end,rangeStatus,type,redirected,rangeHeaderhidden/valid/invalid,partialLengthnumeric/hidden/invalid,headStatus/headLength/headSameResource,expectedLength. Mainfailure/success menyertakansourceResponse. TidakmenyalinURL/rawheaders/nativeerrormessage. Tes membuktikanHTTP200,headerinvalid danfetchthrow dapatdibedakan tanpaURL/token.
- 14targetedpass,1464fullpass,lintreader/tests/mainpass. Build697368f0593b disajikanstaticolehPID10828 (tidakrestart),clientdebugmasitrue;modeclient. Userperlumencobalagi danmengirimlogbaru sourceResponseuntukdiagnosisactualSafari. Belumfixresponsberdasarkanhipotesis danbelumcommit.
- Upaya alatWebKit lokalPlaywright diTEMP belumberhasildipasang (ekstraksiberhenti), helperinstaller miliktugasdihentikan. TidakmengklaimtesSafari/WebKitlangsungdariupayaini. Profilbrowseruser/iPhonetidakdisentuh.

### 49.5 LogSafariHTTP200 setelahredirect dan pemulihanRange langsung

- Userlog12:54:57Z/build12:52:39 menunjukkan15dari20kandidat rangeStatus200,rangeTypecors,redirectedtrue,rangeHeaderhidden,partialLengthukuranfilepenuh (contohid2=2525414437). Limaid1/12/17/18/20 gagal tanparespons. Ini bukti15responslolosCORS tetapiRange tidakditerapkansetelahredirect; bukanffprobe/codec/queue. Belummembuktikanapakahbrowsermembuangheader atauperantara/servermengabaikannya; janganmengklaimbugSafariinternal spesifik.
- Reader kini membatalkanHTTP200redirect sebelumbodydibaca, lalu sekali memintaRangeidentiklangsungkeURLakhirCORS-readable. Terbatasuntukredirectedtrue+URLhttp(s)berbedadaritarget. Retrytetapharus206/ukuranvalid/budget, tidakmenerima200ataumengulangselamanya. PermintaanRange/HEAD memakai cache:no-store supayaresponsfull/parsialcachetidakdipakai sebagaibukti. TargetCDNdigunakanlagirangeberikutnya, seluruhnya browser tanparesolver/proxyNuvioserver. Diagnostik menambahredirectRangeRetry daninitialRangeStatuspada percobaantersebut.
- 2regresibaru: cancelwholebeforeexactretry+reusetimeURL; secondHTTP200ditolak/cancel/calls2/mediaBytes0. 16targetedpass,1466fullpass,ESLintreader/testsdan diffcheckpass. ChromeWorkerffprobeasli denganfixture owned danservermenghasilkan302->200 membuktikan responsfulldibatalkan,laluGETlangsung206+HEADfallback suksesnormalizemetadataMKV/dualAAC. Ini uji reproduksiterkontrol, bukan hasilaktualiPhone.
- Build479dea56fffd disajikanPID10828;publicmodeclient/endpointkosong/debugtrue. Tidakrestart/cacheclear/commit. Userperlu reload danmencobaStremThruyangsama; kirimloglanjutanuntukmemastikan15jalurpulihdiSafari danmenelusuri5fetchfailureyangtersisa. Jangan menyatakansemuaUnknownselesai.

### 49.6 Optimasi client setelah buktilogSafari sukses tapi lambat

- Userlog13:05:43Z/build12:57:58 memperlihatkan23jobs:12success,5probe-byte-budget,6fetchfailure. Success5.463–12.745detik;6inisialisasiWASM4.123–5.410detik,total28.362detik. Setiapbyte-budgetfailuremembunuhWorker sehingga coreberulang kali diinisialisasi. Media15–32ranges,3.68–8MiBperjob. Jangan menyimpulkandeviceCPU sebagai penyebabtunggal;metadata-stage masihmencakupnetwork+ffprobererun.
- User meminta percepat. RangeReader sekarangadaptif: initial/random256KiB, consecutive512KiB lalu maksimal1MiB, clampedkesisa8MiB. Randomseekkembalike256KiB. Chunkadaptive mengurangi roundtripdanffprobeulang; tidakmengubahukuranfile/codecassess/deadline/candidateorder/CORS atau membuatfullfilebuffer. Batas8MiB full sequential kini10requests dibanding32.
- Source/range/bytebudgeterror saatWorker menungguchunk tidaklagi fatal: mainmengirimreleaseid untukmembuangjob/chunks laluWorker/coretetapsiapuntuksumberberikutnya. Timeout/Workererror/postMessageerror tetapmematikanWorker. Workerhanya menerima releaseuntukidaktif, idberikutdiprosesserial;cleanupFFSrunsebelumnyasudahberakhir. Idle30detiktetap. InitialfetchfailuremasitidakmemuatWASM dantidakmembuangcorehangat.
- Tambah4regresi: sequentialgrowthbudgettepat,randomseeksmall,bytebudgetrelease/reuse,nextsourcefreshsetelahWorkererror.20targetedpass,1470fullpass,ESLintsemuaJSoptimasilulus,diffcheckbersih.
- Uji linkStremThruuserdiChrome sebelum/after:16->6ranges,bytespersis4113445samadansemuametadatanormalizedidentik (deepEqual). Coldtime3074->3096ms pada2run berbeda, jadijanganmengklaimpeningkatandurasidiChrome/ponselsebelumloglanjutan; pemuatanawalWASMmasidominan. BrowserWorkerasli denganownedfixture membuktikan partialfailureHTTP503 lalu sumberMKVvalid tetap1inisialisasicore. Uji redirect200recovery dan3GBsparse/dual-audioexistingtetaplolos.
- Build7238a3321e40 sudahdisajikanPID10828,modeclient/endpointkosong/clientdebugtrue. Tidakrestart/resetprofil/cache/commit. Userperlu reload danujiulangjudul/sumberyangsamalalusalinlog. Cekjumlahworker-script/wasm-loading tidakberulang setelahbytebudgetfailure,jumlahrangesdanlatency. Batas8MiBmasidapatmenyebabkanUnknown;fetchCORSfailuretidakdiselesaikanoptimasiini.

### 49.7 Percobaan2Worker ataspermintaanuser

- Userlog13:19:42Z/build13:13:57 menunjukkan optimasisebelumnyaaktif:6–10ranges,bytebudgetfailuretidaklagimemicuWASMinitulang. Tetapadasumberlambat/timeouts15detik;useringinmencobaduasekaligus. ImplementasimemakaiduaWorkerindependen untukffprobeWASM yangsinkron;tidakmengklaimdua ffprobe simultanbisapadasatuWorker.
- Tambahhoster PROBE_CLIENT_CONCURRENCY=1|2,default1,invalidtermasuk3kembali1. DidukungNode/publicruntime/buildenv/DockerCompose+entrypoint. Modeprobe tetapserver/client/offdanclienttidakfallbackserver. Poolsharedperpage capmaks2;masing-masingWorker tetaplazy,serialperWorker,idle30detik,8MiBperjob (duaaktifbisamencapai16MiBmedia ditambahduaheapWASM). Sourcefailuretetapreuse,fatalworker/timeoutretirehanyaslotitu. TidakmemilihjumlahWorkerotomatisdaricoredevice.
- Semua pemanggilcreateStreamProber meneruskanclientConcurrencydariconfig. Streamlist memakai2lane yangmengambilkandidatberikutnyadariurutanatas saatlaneitu selesai, tanpamenunggupasanganlambat. Hasiltiapfilelangsungmemperbaruilabel. Addonscope/HDRpriority/pagecap/selectionsdeadline tetap. FIRSTSTREAM padaDetailtetapprobeurutkandidat,sehingga tidakmemilihsumberkeduahanyakarenaselesailebihdulu. Panelplayerjuga membatasipendingsesuaikonkurensi. Diagnostiktambahslot(1/2),concurrency(1/2);idjoblokaltiapslot,gunakanpasangan slot+id saatmenganalisislog.
- Bukti:unitpool4jobspeak2/no3/defaultnormalization;UI2job+peerslow menampilkanhasilcepatdanmemulaikandidatketigatanpamenungguyangpertama; urutanstarttetap0,1,2. RealChrome2WorkersmembacaMP4virtual3GB+MKVbersama,metadatadualAACbenar,sourceerrorreuse+redirectrecovery+no-serverfallbacktetaplolos. Node/Dockerentrypointpublicconcurrency2smokepass.69focused+1473fulltestspass;lintJSberubahkecualidebtunusedstreamScreenpass,diffcheckbersih.
- Builde5d7cee4b2d9. Devserverdirestart hiddenPID25012 dengan PROBE_MODE=client,PROBE_CLIENT_CONCURRENCY=2,NUVIO_CLIENT_PROBE_DEBUG=1;runtimepublikterverifikasi. Batasprobe/pathbinary/remuxfalse/transcodefalse/debugstartup+subtitlefalse tetap. Tidakresetprofil/cachebrowser/commit. Userperlu reload/reopenPWA cobajudulsamadankirimlogbaru; pantaujumlahslot/durasi seluruhdaftar dan apakahreload. JanganmengklaimduapastilebihcepatatauamandiiPhone sebelumhasilpengguna. Kembalike1cukupubahenvrestartreload.

### 49.8 Perbandingan log1vs2Worker, belumubahkode

- Userlog13:34:23Z/build13:29:20 memintaapakahlebihcepatkarena tidakterasa. Dibandinglogsebelum13:19:42: satupool23jobs/11success/12failure,wholelist112844ms,firstlabel10232ms,warm-successmedian4739ms(n9),WASMinit5213+6344ms (keduasetelahtimeout),media112959878bytes. DuaWorker20jobs/12success/8failure,wholelist59400ms,firstlabel14314ms,warm-successmedian5983.5ms(n10),duaWASMinitbersamaan8620/8750ms,media98330393bytes.
- Jadi rekamanduaWorker seluruhnyalebihsingkat tetapi hasilpertama/perfilelebihlama; janganmenyebut2xlebihcepat benchmarkterkontrol karena jumlahjobs/data/failureberbeda. Fasewasm-loading mencakupdownload/compile/init, bukanCPUperangkatmurni. KeduaWorker mulaiinitbersama, selarasdenganbiayaawal8.6–8.8detik dibanding5.2detiksebelumnya; janganmenetapkanbottleneckCPUtanpapengukuranlebihlanjut.
- Saranberikutnyajikaprioritashasilpertama: Worker1lebihdulu, bukaWorker2setelahhasilpertamaagarinitawal tidaksalingbersaing; perlumengujibukanmenjanjikanwaktu. Pada turnperbandinganini tidakmengubahkode/config, runtimePID25012 masihmodeclient/concurrency2/debugtrue. Scriptanalisis.cache/compare-one-two-probes.cjs, outputsummarytidakmengandungURL/token. Belumcommit.

### 49.9 User setuju startup1Worker lalu2setelahhasilpertama

- Mengubahpool agarawalnya hanya slot1 tersedia,slot2bolehsetelahfirstsuccessfulmetadata. Runner mengeksposwarmstate (metadata/result=true,stop=false);poolreadinessmemerlukanfirstsuccess+minimal1corehangat. SourcefailureyangcoreWASMnyasudahloadedtidakmembukaduaparalel. Setelahsemuacoreidle/retired, firstResultReadyresetdancoldstartkembalike1. Batasmaks2 danmodeconfigtetap.
- StreamprobermengeksposclientParallelReadyuntukcallers. Streamlistloopawalserialsampaisatuhasilvalidditerbitkan, lalu2rollinglanes; tidakmengirimkandidatkedua menunggudalamqueue15detikselamafirststartup. Panelplayerjuga pending1sampaipoolreadybaru2. Urutansumber/HDR/addons/pagecap/8MiB/timeout danFIRSTSTREAMselectiontetap. Globalpooltetapmenolakslot2awaldaricallerlainyangkebetulanmengirimbeberapasekaligus;deadlinequeueexistingtetap.
- Tespoolupdated:1coldWorker/readyfalse,firstsuccessreadytrue,baru4jobspeak2,no3. Tambah2regresi:filefailedsetelahmetadatastage tidakunlockkedua,allcoresidle kembali1. UIregresimembuktikanrequestpertamasaja dimulai, hasilpertamamuncul,baruduasumberberikutjalanbersama+hasiloutoforderbisaterbitlangsung.36focused/1475fullpass,ESLintchangedJS(exceptexistingstreamunusedimportdebt)pass,diffcheckbersih.
- RealChromeWorkersownedfixtureslolos: secondworker-script stage terjadi SETELAH firstsuccess;tetapMP4virtual3GB/MKV/dualAAC;sourcefailurecore-reuse/redirect200recovery/no-serverfallbacktetaplolos. BelummengujiwaktuaktualSafari danjanganmenjanjikanhasilpertama10detik.
- Build4396645cbb30 sudahdisajikanPID25012 tanparestart;runtimepublikclient/concurrency2/endpointkosong/clientdebugtrue. Userperlu reload/reopenPWA danmencobajudulsamadankirimlogbaruuntukfirstlabeltime+wholelist. Tidakresetcache/pengaturanprofil,tidakcommit.

### 49.10 Unknown dan keputusanremux; contohAV1Torrentio

- Userlog14:15:45/build13:44:36:20jobs (slot1 id1–13,slot2id1–7),12probesuccess,3byte-budget(2292663491,2996240426,1688308447bytes),5fetchfail. Firstlabel21:14:42.043-firstqueued21:14:32.451=9592ms,wholelist55543ms. Stagedstartbekerja:slot2barudimulai42.083setelahsuccess42.043. JanganmenyamakanprobesuccessdenganDirectkarenaassessmentbrowserbisamasihunknown.
- Userbertanya bagaimanamenentukanremux/transcodenanti;arahyangbenar metadatafile+capabilityperangkat,Unknownbukaninstruksikonversi. Auditbadge sudahmengharuskanprobe; menemukanresolvePlayerSource masih classifydenganteksaddon saatprobeabsen. Guardbaru mengembalikanURLasal jika tidakadaprobe, sebelummemutusremux/audio conversion; existingexplicitrelayhistoryURLtetapdipertahankan. PositivetestMKVcapabilitytetapberfungsi. RegresiunprobedMKVH264AAC tidakbolehrequestrelay.53targeted/1476fullpass,ESLinttestpass(diffdebtstreamunusedimportlama),diffcheckbersih. Build76b79ff03aa7disajikanPID25012;tidakrestart/resetprofil/commit.
- MemintacontohStremThruUnknownyangbatas8MiB. UsermemberiTorrentioTorBox hash748117a0.../file0/AV11080p7RIP.mkv, mengatakanUnknowniPhonedanChrome. UjilinkasliChrome membuktikanfetchblocked pada307api.torbox.app tanpaACAO;WASMtidakmulai,0bytes. CDNfile969985258bytesmemilikicors+206. Ini kategorigagalakses,BUKANcontoh3bytebudgetdiatas. JanganmenyebutAV1tidakdidukungberdasarkanUnknowninisebabbelumdibandingkankemampuandevicenya.
- Untukpembandingdiagnostik,gunakankonfigurasiStremThru useryangsudahdipakai denganhash/fileindex/nama yangsama;tidakmenulisulangURLapp/settingaddon. LinkStremThrutersebutlangsungCDNdancorslolos. ActualChromeWASMsuccess2501ms/2ranges/314602bytes:MKV,AV1Main,codecStringav01.0.08M.10,1920x1080,24fps,AACHE-AACstereoeng,durasi9382.483s,SDRbt709. Metadatafilebisadibaca ketika jaluraksesnyaCORS-valid. TidakmengklaimDirect/remux/fulltranscode untukiPhonebelumadaassessmentdarisana. URL/tokenprivat hanyahelperignored.cache,tidakditrackedfile/laporan.
- Probeclienttetapmurnibrowserdanserverfallbacktidakditambah. PertanyaanuserUnknowniPhoneatauChrome:yangdimaksudawalnyaiPhone,contohyangjugagagalChromeberguna. Masihmemerlukan1tautanStremThruUnknown dari3bytebudget untukinspeksistrukturfiletanpafull-download. Fulltranscodingimplementationtetapditunda sesuaiuser. BelummengubahlabelUnknownUI atau menaikkanbudget8MiB.

### 49.11 PandaQT Unknown vs PoNg terlabeli: penyebabterbukti moovbesar

- UsermemberiStremThru/TorBox hash1e055afe.../file3/PandaQT.mp4 yangUnknowniPhonedanChrome, lalu membandingkan hashf72a9.../file0/PoNg.mp4 yangterlabelikedua perangkat. KedualinklangsungCDNdenganCORSvalid,206valid;PandaactualChromeWASM berhentipro be-byte-budget10ranges8388608bytes sebelummetadata lengkap,file2292663491bytes. BukanCORS/decoding/devicesupport.
- InspeksiatomMP4 dengan4request32byte(128bytes)perfile: Panda ftyp32,moovstart32 size10220675,free8,mdat2282442776. PoNg ftyp36,free8,mdat2521702392,moovdiakhir start2521702436 size3712001,totalfile2525414437. JadiPandaheader moov10.22MBmelebihicap8MiB,sedangkanPoNgmoov3.712MB masihterbaca. FilePanda justrulebihkecilkeseluruhan;ukuranvideoGBtidakmenentukanbiayaprobe.
- UjidiagnostikterpisahChrome denganmaxBytes16MiB HANYAdilabbundle (esbuildpluginmenggantikonstanta,tidakmengeditkodeapp): PandaWASMsuccess3315ms,12ranges11272192bytes,MP4/H264/AAC. MenegaskanmetadatabesarpenyebabUnknown, bukanfiletidakdidukung. JanganmenyatakanDirect/RemuxuntukiPhoneberdasarkanhasilinibelumassessmentperangkat.
- Productionbatas8MiB belumdiubah,buil d76b79ff03aa7/PID25012/modeclient/staged2Workers/debugtrue tetapsebelumnya. Helpersignored.cache/probe-panda-atoms.cjs,probe-pong-atoms.cjs,check-user-panda-16mb-test.cjs;rawURLs/tokenhanyadiignoredhelper,tidakdi trackedhandoff. Tidakdownloadfullfile(2GB),tidakcommit. Langkahberikutperlu kebijakanmetadataMP4besar (misalcapadaptif berdasarkanukur anmoovdenganhardcap),bukanmengonversiUnknownotomatisataumenaikkansemuabudgettanpabatas.

## 50. Resolve URL on-demand bersama (2026-10-25)

- User menyetujui resolve hanya untukkebutuhan label/copy/download/fiturCORS lainnya; bukanmengambilsemuaURLsekaligus. Clientpure tetapberlaku,tanpafallbackNuvioserver. AuditkodepublikTorrentioRust master:http/server.rs resolve_response/redirect_response hanya302,providerstorbox.rs memakai download_linkyangdebrid/torbox.rs membangunrequestdlredirect=true. TidakmenemukanJSON-CDNroutepadajalurresolveitu;ini kodepublik, bukandasaruntukmengklaimversionprodidentik. Browserujilinkuser tetapmemastikanAPI TorBoxCORSblokir. Janganmenjanjikanresolverbaru dapatmembukaCORSyangditolak.
- Tambah core/streams/clientMediaUrlResolver.js: browser-onlyHEAD CORS credentialsomit/no-store; fallbackGET Range0-0jikaHEADtidaktersedia/CORSgagal/405/501, selalu cancelbodysebelumdibaca (termasuk200penuh). HanyaURLhttp(s),status200/206,HTMLditolak. Timeout8s+AbortController. SignedURLcache hanya memoriTTL60detik/maks100entry, inflightdedup, invalidation;failuretidakdicache, tidaklog/persistURL ataupakaiopaque/proxy. Tidakadaresolvingotomatis saatlistdimount.
- Probelabel tetapmemakaiRangepreflightyangada (tanpaHEADresolve tambahan), menyimpanURLCDNsetelahvalidpartialread. Readerberikutdapatmemakai cachedCDN. Cacheindependendaristatuscodec: fileyangmencapai8MiBtetapbisamenyimpanURLCDNyangesudahvaliddiakses, bukanmenganggapplayabilityverified.
- Copy Stream Link memakaicachedCDNatauon-demandresolve; ClipboardItemPromiseBlob memulaiclipboardwritedalamgesture sebelumawaitnetwork untukSafari. JikaCORSgagal,tetapcopyURLaddonasal(bergunabagi nativeplayer), tidakmengakuinisebagaiCDN. FallbackwriteText/execCommandtetap. BelumteslangsungclipboardSafari, unittestmembuktikanorderingAPI sebelumnetworkresolve. Existingnativeexternalplayerlaunch tidakdipaksaresolveCORS.
- Browserdownload fetchResponse memakaiURLCDNresolvedtanpamengubahdescriptor/fingerprintmedia, sehinggasignedURLtidakmenjadikanidentitasdownloadberubah.401/403/410 invalidatecachedlink danexistingresume/refreshroutestetap. JikaresolvegagaldicobadownloadURLasaldenganaturanbrowserexisting;tidakbypassCORS. ExistingDirectDebridResolveruntukdeskriptortorrenttanpaURLtidakdiubah (jalurdebridlamaterpisah);modulURLbarutidakmenggunakannya.
- Testsbaru5resolver+3copy:lazy/dedup/TTL/eviction/invalid/nonmedia/abort/CORSfailnotcache, Rangefallbackcancel, probe->cachedresolve noextraHEAD, cachedcopy,ClipboardItemgestureordering,blockedcopyoriginal.48targeted/1484fullpass,ESLintsemuaJSbaruberubahpass,diffcheckbersih. BrowserChromeownedfixture actualHEADredirect->CDNcached->probeGETlangsungCDN (tidakmengulangrouteaddon)lolos;stagedWorkers/3GBMP4/MKV/reuse/redirectrecovery/off/noserverprobetetaplolos. Tidakdownloadvideoasliuntukujidownload.
- Build9e8b0a37b1d3 disajikanPID25012,modeclient/stagedconcurrency2/debugtrue,tanparestart/resetcachebrowser/commit. Cap8MiB produksi belum13MB; userbaru menyebut13MBlogis, perubahanbatchinibukanpenambahanbudget. BatasbesarPandaQTdanupstreamCORSmasihbatasanberbeda. Userperlu reload,ujicopy/downloadsumberStremThruyangsama;TorrentioAPI-CORS tetapunresolvedclient.

## 51. Bantuan backend instance untuk URL labeling (2026-10-26)

- User secaraeksplisit mengizinkanserver membantumemperolehURLCDN danmenanyakanprivasi. Klarifikasipenting:serverNuvioyangdimaksud=backendINSTANCE NuvioWeb user(movi.alphasquare.my.id), bukanserverpusatdeveloperNuvio/NuvioWeb. TBInstantlamasudahmemakaibackendinstanceuntukresolve. Otorisasiini menggantipilihanclient-onlyuntuktahapURLresolution; ffprobe/datafilm tetapbrowser. Janganmemintaizinulangkecualiscopeberubah.
- Implementasioptin MEDIA_URL_HOST_RESOLVE_ENABLED=false(default),aktiftruepadadeploymentuji. SakelariniindependendariPROBE_MODE;PROBE_MODEclienttetapmematikanendpointffprobeserver. Publicruntime+Node+Dockerfrontenddancontainerdebridbridge menerima flag; routebackendsendiritolak404jikaoff. ConstructorbridgeaddonResolveEnableddapatdiinjeksitest. Tidakmembuatlayanan/proxyarbitraryURLbaru.
- Clientcore/debrid/torboxAddonUrlResolver.js hanya menerima HTTPS hostnameexacttorrentio.strem.fun/pathresolve/torbox/credential/40hexhash/entry/numericindex[/filename], tolakuserinfo/controlchars/hashinvalid. TokenheaderAuthorization,POSTdescriptorJSON{infoHash,fileIdx,entry,filename} ke /api/debrid/torbox/link/from-addon. Tidakmengirimtoken/fulladdonURLdidalamURLrequestkebackend,tidakmemakaikeyprofilberbedadarisource.
- BackendmerekonstruksiURLTorrentiofixed,GETredirectmanual,langsungcancelbody. LocationwajibHTTPSapi.torbox.app/v1/api/torrents/requestdl,userinfoempty,tokenSAMAdengankredensialpeminta,torrent_id/file_idnumeric. LaluGET tepatkeLocationyangdivalidasi (pertahankanqueryasli),redirectmanual,cancelbody;CDNLocationHTTPS,userinfoempty,bukanapi.torbox.appdikembalikansebagaiJSONsuccess/data. TidakmengikutiCDN/membacavideo/memanggilcreatetorrent/listaccountAPI. SemuaroutePOST/no-store,errorgenerictanpaechokredensial;handler tidakmenambahkanDB/logbody/telemetry. Hostadmin tetapbisamelihatdatadiproses,customproxylogging/profilesyncdatayanglamatidakdiaudit/diubah. Torrentio/TorBox tetapmenerimadatauntukresolveaslinya.
- SharedclientMediaUrlResolvermemakaiflagoptin;ProbeRangeReader mengenaliURLknownyangtakbisaCORS laluresolveViaHostsebelummencobaCORSchainuntukmenghindaribuang15detik. ClienttetapGETRangeCDNdanWASM;memorycacheURL60detik/maks100,dedup,invalidate existing. SupportedURLlainyangsudahCORSvalidtetaplangsungclient. GagalCORSnon-TorBox/non-Torrentio tidaktiba-tibadiproxy. SourceResponse.hostResolvedtruebertahanseluruhreaderjobuntukdiagnostik. Copy/downloadjuga dapatmemakaiURLyangdicache atauondemandmelaluisakelaryangsama;nativeplaybacktidakdipaksaresolve.
- Investigasiawalreuse3APITBInstantcreate/list/link tidakdipakai:livecreatetorrenttimeout15detik. VersiJSONrequestdlredirect=falsejugaseringtimeoutprovider(terukuraddon302112ms,providerrequesttimeout10s). MempertahankanLocationasli denganredirecttruememberi307provider5779ms pada ujidirect, menghindarimengubahparameteraddon. Prototype3API/no-serverchangessebelumnya sudahdiganti,bukanfituryangperluDipertahankan.
- BuktiutamaPUBLICChrome padamovi.alphasquare.my.id sesudahaktivasi: URLTorrentioAV1yangsebelumnyaCORSgagalkiniWASMsuccess9729ms/2ranges/314602bytes,file969985258bytes,MKV/AV1Main1080p/AACHE-AACstereo;clientfetchkeAPIhanyasatuPOSTfrom-addon tanpaquery,tidakada/apiprobe.Serverhanyaduaheaderrequests. LogproofTEMP/nuvio-host-header-public-proof.log berisimetadata/stats,sumberprivathanyadiignored.cachehelper,takditrackedfile. LocalChromeearlier6.115slolosdenganJSONversiontapiseringtimeout;finalpublicproofuntukheaderversionlahyangdipakai.
- Testsbaruparse/sourceallowlist/POSTtokenheaderonly/abort,noopaque/nohostunlessoptin,preferredhostbeforeblockedredirect,backendoff/untrustedLocation/accountmismatch/invaliddescriptor/noCDNfetch/fullmediaresponsecancel. 1494fulltests pass,lintsemuaJSfeaturepass,diffcheckbersih. Builda38e4f0f0340(frontend),serverheader-onlybackendterbaru; perubahanserver setelahbuild tidakmemerlukansalinassetlagi.
- DevservercurrentPID18328hidden,PROBE_MODEclient,PROBE_CLIENT_CONCURRENCY2(staged1->2),MEDIA_URL_HOST_RESOLVE_ENABLEDtrue,NUVIO_CLIENT_PROBE_DEBUG1,subtitle/startupdebug0,remux/transcodefalse. FFmpeg/ffprobeJellyfinpaths+probequota/page20/TTL/limitslama dipertahankan. Publicruntimeflagtrue/endpointprobekosongterverifikasi. Serverrestartmenghapuscachebackendinmemory,bukanprofilebrowser. Belumcommit/push. Userperlu reloadPWA/Safari danulangsourceTorrentioAV1. KasusPandaQTmetadata10.22MBtetapmelewati8MiB;13MBbelumditerapkan,terpisahdariCORS/hostresolve.

## 52. Regresi host resolve / Unknown dan prioritas daftar (2026-10-26)

- Log iPhone build17:39: 12attempt,7host-resolve-failed,1hosttimeout15s,4rangefetchfail;semua workerStartedfalse/mediaBytes0. Bukan bukti codec/deviceunsupported.
- Koreksi penjelasan sebelumnya: awaitcacheavailability/awaitgambar sudah ada diHEAD dan bukan perubahan terakhir. TBInstant juga memiliki scheduleDebridPreparation terpisah yang tetapaktifclient; jangan menyimpulkan guardresolveUnknownRows sebagai penyebab kartu lambat.
- Uji nyata cache/check TANPA terlebih dahulu menjalankanhostresolve: timeout15052ms. Ulangsetelahrestart15051ms; GETnativecachetimeout7503ms,POSTberhasil7110ms/cachedtrue. EndpointTorBoxfluktuatif. Belum terbukti kausalitas bebanresolvebaru terhadapTBInstant; tidakmengklaimkelambatanupstreamselesai.
- Clientbackgroundlabel dihalamanmanual/OnlyDirectoff menungguloadingdaftar selesai sebelummenambahprovidertraffic. OnlyDirect/auto-selection tetapbolehprobe saatloading agar tidakmenghabiskanselectiondeadline. Filter/sorting/presentation tidakdiubah. RawTBInstant tetapdipersiapkanolehpreparerexisting,tidakbulkresolveulangseluruhdaftar sebelumlabel.
- ProbeRunner opsi resolveTimeoutMs untuk background: jatahpreparemaks15s + probe15s,denganbatastotal30s/queueincluded. Detailauto-selection tidakmengirimopsi,harddeadlineoriginaltetap. Browserpanelbackgroundmenggunakanopsiyangsama,next-episodeautoselectiontidakdiubah. Readerpreparehost terpisah;requesttimeout16s memberimarginmenerimaerrorbackend15s,tetapdibatasirunner.
- HostfailuretidaklagivetoCORSsource: satupercobaanrangeoriginaltetapdiizinkan,janganpanggilhelperdua kali saatkeduanyagagal. Tidakopaque/proxyvideo/fullfiledownload. SourceResponse mencatathostResolveMs/statusdanfailurestage/statusenumtanpaURL/token. Backendmemberikanaddon/provider+upstreamStatus+reasonterkontrol,tidakrawresponse. [DebridCache] opt-inclientdebug mencatathashCOUNT/status/duration/success,tidakhash/key/judul.
- Testbaru: separatebudgetvsselectiondeadline,helperfailure+CORSsuccess,helperfailuretidakduplikat,render8cardsbelumprobe,loadingmanualdeferdanOnlyDirect/autoselectiontetapjalan,errorhop429sanitized. Full1500pass. Featurelintclean;knownoldunusedimports player/stream tidakdibersihkan.
- PublicisolatedChrome test sourceTorrentioAV1:5147ms,host2550ms,2ranges314602B,file969985258,MKV/AV1/AAC. SatuPOSTfrom-addon,tanpaquery/api-probe. Tidakmenjanjikansemuasumber/iPhonesudahfixed;provideroutage/CORS/budget8MiBterpisah tetapdapatUnknown.
- DevserverPID24044hidden;configclient,concurrency2,hostresolvetrue,clientdebug1,subtitle/startupdebug0,remux/transcodefalse;runtimeenvdipertahankan. Semua uncommitted. Probe cachebrowseruser tidakdihapus otomatis.

## 53. Terapkan cap13MiB, budget init WASM, HTTPS dan diagnostik label (2026-10-26)

- Usermengizinkansemuaperbaikan setelah8URLuser(diantaranya label/hrefpertamaberbeda) diuji. Ujisebelumperubahan:PandaQT/cinecalidad/store720 memerlukan>8MiB;diag13MiBketiganyalolos. HTTPJellyfin terblokirmixedcontent;HTTPSlolepadahostyangsama.
- PRODUKSI sekarangPROBE_MAX_BYTES=13*1024*1024(13631488),bukanlagihanyalab. Chunkawal256KiB,sekuensial512KiB->1MiB,readterakhirclampbudget,tidakfullfiledownload. Defaultbudgettestmencapaipersis13MiBdanmenolakrequestberikut.
- ProbeRunner background(resolveTimeoutMs>0) coldinitializationbudget20s terpisah dari15sfileprobe/15sresolve;totalmaks50squeueincluded. TimerfiledihentikansaatcoldWorkerstart,dilanjutkanpadastagemetadata denganwaktusebeluminityangtersisa. Warmworker tidakmenghabiskanbudgetinitulang. Initializationhangtetapbounded/destroysworker,ordinaryfatalprobetimeouttetapterminate. Auto-selectiontidakmemesantambahanphase sehingga harddeadlineexistingtetap. Logqueuedmenampilkanbudgetinit;resultmencatatinitializationMs.
- secureMediaUrl purehelper: HTTPSapp mengupgradepublicHTTPmedia URLkeHTTPS sambilmempertahankanquery/port. Domainlokal/IP danHTTPdeploymenttidakdiubah;tidakfallbackHTTPsesudahTLSgagal. DigunakandimapStream(repository),playerdirectPlaybackUrl(coversresume),sharedresolver,rangeReader. Tidakmengubahsettingsprofil/filter/sort,tidakhardcodehostnameuser. TidakmenjaminhostlainpunyaHTTPS;ujiuserJellyfinberhasil.
- ProbeDiagnostics: sourceId FNVtagtanpaURL/keyuntuksemuaClientProbeevents;PlaybackLabel opt-inconsole+dedup200 mencatatmethod/reason/engine/capabilityflags/dimensions/channels sehinggaUnknownsesudahprobesuccessbisaditelusuri. CDNgagalHTTP>=400 dibacaerrorbodymaks4KiB,catatcategorytetapsaja/discardraw. TidakmengiraHTTP400=CORS;tidakblindretry/auto-transcode. TigaHTTP400logiPhonebelumbisadireproduksidiChrome,sehinggapenyebabpenolakanbelumdipastikan.
- LogiPhonesectionini22attempt13success9failure(3HTTP400,3timeout,2bytebudget,1initialfetch/mixedcontent);LAMAfile3095505925sudahsuccess5.784s;PSAfile1099099247timeoutdiwasmload;cine2996240426timeoutsetelahinit;store4k1078493002awal15stimeoutlaluretrysuccess3.704s. TorBoxcache82hash974ms,normalpadalogini.
- Testsbaru:coldinit300mslolosfiledeadline200msbackground+warmreuse,secondcoreinitonce+reuse,initstuckbounded,selectioncannotextend,secureHTTPpath+querypreservation+LAN,CDN400category+4KiBcap/noresponseleak,sourceTag&labeldiagnosticsoptin/dedup/noURLtoken. Full1510pass,featurelintclean,diffcheckclean.
- Build0446cb14c7ed/cache6aad9b8811d4,devserverPID13448tetapjalanhidden configsebelumnya. RealPUBLICisolatedChrome defaultproduksi13MiB: SELURUH8targetmetadataSUCCESS:Panda6.508s/11272192B;store4k2.910s/5537610B;cine4.285s/11272192B;LAMA3.150s/7077888B;PSA2.029s/453743B;store7203.414s/10586847B;ExKino1.694s/303994B;JellyfinHTTPoriginalupgradedTLS0.666s/441739B. DetailsTEMP/nuvio-user-unknown-fixed-results.json. IniChrome,bukanbuktiujifisikSafari;userperlu reloadversiterbaru. SourceURLsprivat tetapignored.cache,takditracked. Belumcommit.

## Client probe deduplication (2026-10-26)

- Deduplicate successful metadata and concurrent work by complete torrent hash/file index across known Torrentio TorBox, StremThru Torz and structured TB Instant descriptors.
- Exact URL fallback for unidentified sources; never merge by filename/size/weak legacy identity. Failed shared source may retry an alternate URL; selection wait retains deadline.
- Cache remains per-prober memory only; local capability assessment stays per caller. No persistent cache or server media transfer introduced.
- Focused tests cover cross-route reuse, distinct files, weak identity, failed alternate and short selection deadline.

## Persistent client probe metadata (2026-10-26)

- Added local IndexedDB file-facts cache, schema 1, 30-day TTL and max 1,000 entries, strong torrent hash/file-index keys only.
- Whitelisted normalized codec/container/audio/HDR metadata; source URLs, credentials, device assessment and failures excluded.
- Cache lookup bounded to 150 ms within caller deadline, storage failures fall through to live probe, writes do not block labels.
- Settings > Advanced > Cache > Clear Probe Cache clears persisted data and invalidates RAM. Pre-clear jobs cannot repopulate caches. Reopen source list; reload other tabs if open.
- Real isolated Chrome IndexedDB proof: reload reuse, expiry, eviction, sensitive-field exclusion, local capability reassessment and clear invalidation.

## Client label count and explicit addon selection (2026-10-26)

- Settings > Streams: Choose placeholder until addons selected; empty selection no longer means all addons.
- Client labeling limit choices 3/5/8/10, default 5; saved per local profile in streamBadgeSettings.clientLabelLimit.
- Shared cap policy used by stream list, detail Direct auto-select, player sources/episode sources and Direct next episode. Host nonzero cap remains an upper bound; client cap applies even with host zero/unlimited.
- No label probes without selected addon; Direct-only lists stay empty in that state. Ordinary lists retain all addon streams when Only Direct off. Labels beyond client cap hidden.
- Validation: isolated Chrome Settings markup/action proof Choose, no All addons, exact choices and persisted selection; tests exercise missing selection, all four limits, source order, profiles and host cap.

## Independent text compatibility filter (2026-10-26)

- Added Playback > General > Filter streams by device compatibility, OFF/default, LIKELY_DIRECT, LIKELY_DIRECT_REMUX, stored in local player profile.
- Uses current native browser capability snapshot and existing text classifier before probe/addon candidate cap. Incomplete/unknown descriptions and conversion candidates omitted when enabled; Off restores them.
- Applies to manual stream page, player sources/episode sources, auto-select and Direct startup/next episode. Independent of labeling toggle and label addon selection; only labeling still requires chosen addon.
- Does not resolve addon links, fetch media or infer codecs from URL query credentials. No changes to connected-server filter/sorting and no new Movi path.
- Browser proof: option visible with labels off, exact choices, selection retained on reload. Unit/integration tests cover native MKV support, pre-cap filtering, manual labels-off behavior and Binge Group respecting filter.
- User clarified Movi engine is abandoned; do not reintroduce it in future Playback reorganization. Existing general-section restructuring remains for discussion.

## Playback combination audit fixes (2026-10-26)

- Binge Group preference is no longer mandatory in Manual + Autoplay Next Episode. Missing/unmatched hints fall back to the ordinary effective selection mode; provisional preferred-only lookup remains available while loading.
- Shared playerStreamProbeCandidates policy now drives stream page, detail Direct startup, player panels and Direct Next Episode; complete torrent hash/file index counts once across addons. Weak identities use exact URLs. Duplicate cards share verified metadata.
- Next Episode positive timeout now includes addon lookup/retrieval/probing. Selection is serialized, probes start in order with remaining budget, and late results cannot select or overwrite state. Deadline may use an already verified eligible candidate, otherwise picker opens.
- Instant chooses first eligible arrival without probing remaining files; existing 45s source safety bound retained. Unlimited no longer inherits that overall 45s cap. Per-probe timeout remains bounded.
- Regression tests cover missing/matched Binge Group, zero/Unlimited/deadline modes, lookup expiry, stale late probes, partial verified fallback and duplicate source cap consistency. Isolated Chrome smoke: 1s timeout returned at ~1.017s, one selection invocation, no late playback; missing Binge Group fell back correctly.
- Previous ignored .cache/audit-settings-combinations.mjs records the original reproduced failures; its old assertions intentionally describe pre-fix behavior.

## Label basis and Only Direct dependency (2026-10-26)

- Settings > Streams > Label based on: FILE_METADATA/default (Accurate, Slow), FILE_NAME (Inaccurate, Fast); persisted per local profile.
- Filename basis classifies local addon text/filenames with native browser snapshot; no metadata probe, worker, cache lookup or URL resolve for labels. Labels say estimate; unknown text stays Unknown. Existing probe facts cannot override filename labels.
- Only Direct is shown/enabled only with labeling toggle on AND nonempty addon choice. Switching labels off or clearing selected addons saves Only Direct off; runtime policy ignores stale stored flags across stream page, auto-resolve, detail, player and Next Episode.
- Only Direct follows chosen basis. Metadata requires probe facts; filename filters estimates and HDR from text without probe/DirectDebrid preparation. Incoming auto-resolve chunks are filtered before choosing filename Direct sources.
- Client candidate limit shown/applied only for metadata. Filename labels cover selected addons without spending metadata slots. Independent compatibility text filter remains available with labeling off.
- Real isolated Chrome: exact basis choices, metadata limit hidden in filename mode, Only Direct visible when configured then hidden/off when labels disabled, hidden action cannot re-enable it, zero probe/worker requests, preferences retained on reload.

## Unified compatibility settings (2026-10-26)

- Supersedes the separate General text filter / Only Direct controls and the earlier badge-toggle dependency above. Settings > Playback > Audio & Video owns compatibility checks and filtering. Fusion Style keeps only card appearance/label visibility; General has no compatibility link or controls.
- compatibilityCheckEnabled owns checks independently of showPlaybackLabels. Older profiles derive the initial check switch from their saved badge visibility; explicit new check choices persist per local profile. Turning badges off no longer changes checks or filtering.
- streamDisplayMode = ALL / DIRECT / DIRECT_REMUX. The selected checking method supplies the classification: verified metadata or local filename estimate. No strict filename prefilter silently removes unknown descriptions from the metadata candidate queue. Old filter preferences migrate to the unified mode; legacy filter output is disabled for normalized settings.
- Filename method offers All addons (exclusive picker choice) and All streams (zero local cap), plus 3/5/8/10. filenameAllAddons and filenameCheckLimit are separate from metadata addon selection and clientLabelLimit. Returning to metadata never turns All into network permission; selected addons and client cap 3/5/8/10 remain required.
- ALL keeps every addon stream visible while only the configured candidates are checked. Direct filters use checked matches within that scope/cap; pending/Unknown and other addons stay hidden. Disabling checks or having no configured scope suspends filtering and shows all; the saved display mode is retained for re-enabling.
- Shared policy covers stream page, player stream/episode panels, detail startup and auto next. Caps count distinct candidate files across selected addons, not a desired number of Direct results. No per-addon quota, mixed method fallback or automatic search for N Direct matches.
- Validation: isolated Chrome settings/actions/list smoke verifies filename All checks 12 fixture sources with zero probe/media requests; metadata retains one selected addon and five candidates; choices survive reload. Unit/integration tests include Direct + Remux startup and auto next, hidden badges, disabled checks, legacy migration and method changes. Build and full 1556-test suite passed.
- Removed Playback engine / Movi picker and its action from General. No changes to the existing engine implementation.
- Relocation verified with real Chrome rendering/actions: compatibility and filter rows belong to Audio & Video, absent from Fusion Style and General; badge toggle remains in Fusion Style.
- Remux implementation remains deferred. Connected-server filtering/sorting unchanged.

## Remux: batas uji startup terakhir yang disepakati

- Pengguna menetapkan maksimal satu uji iPhone lagi pada pengendali remux lama. Jika gagal, hentikan tambalan startup dan beralih membangun ulang pengendali remux; pertahankan tampilan, subtitle, pilihan audio, dan progres. Jangan mengulang matriks diagnostik.
- Inspeksi USB Inspect CLI pada Safari iPhone berhasil. Buffer32detik, native errornull, audio/videoaktif. Penghitung standar frame92, webkitDecodedFrameCount tidak tersedia; log0 sebelumnya bukan bukti tidak ada decoding. EOS sesudah macet sudah diizinkan pengguna dan dicoba; tidak memulihkan. Hook sementara sudah dilepas; renderer eksperimen berdurasi124 sampai stream dibuka ulang.
- Percobaan terakhir menunggu4detik buffer AV kontigu di depan target sebelum initial seek/Play (lebih pendek dekat akhir film). Anggaran byte tidak naik; jika startup tidak muat, gagal dengan startup-window-exceeds-buffer-budget. Fragment awal88–~~91.968 hanya menyisakan~~0.35detik di depan target91.617, kandidat race, belum akar masalah terbukti.
- Build2026-10-28T18:28:30.303Z; assetremuxbf35f7fffb0e;1600tes lulus. Public bundle cocok hash hasil lokal pada https://plane-alex-lead-direction.trycloudflare.com/. Hasil fisik iPhone masih menunggu. Catatan rinci di folder lab remux-prototype/STARTUP-WARMUP-LAST-TRIAL.md.

## Remux checkpoint — 2026-10-29

- Tahap 1 konfigurasi hoster dan tahap 2 client remux/player disimpan bersama. OPFS, selected AAC stereo/AVC MKV, subtitle teks, seek/progress/cleanup dan diagnostik startup tercakup; bukan klaim siap produksi.
- Uji terakhir build 2026-10-28T18:28:30.303Z awalnya masih gagal. Pengguna kemudian melaporkan iPhone bisa memutar; tidak ada perubahan kode dalam investigasi terakhir. Penyebab macet/pulih belum terbukti, jangan menyalahkan RAM atau mengklaim perbaikan iOS sebagai sebab.
- Pengendali pengganti belum dibuat. Autoplay elemen utama berbeda dari harness tanpa autoplay; celah verifikasi, bukan akar penyebab terbukti. Tahap 3 server HLS dan tahap 4 UI/penerimaan belum selesai.
- Build lama 2026-10-28T12:36:58.882Z tidak ditemukan sebagai artefak/snapshot; rollback tersebut tidak dilakukan. Source dan dist sebelum commit dicadangkan di folder lab saved-current-2026-10-29 dengan manifest SHA-256. Jangan menjalankan ulang skrip patch lab yang hanya untuk sekali pakai.

## Existing server HLS track choices — 2026-10-30

- User requested rollback before the independent server pipeline, then improvements on the working old route. Restored source to 22e1a8b0 first; stage3/4 changes archived with SHA-256 manifest under lab server-route-before-rollback-20261030. Do not reintroduce /api/remux/sessions or its windowing controller.
- Existing server mode is the legacy inferred policy: REMUX_MODE empty, REMUX_ENABLED=true, REMUX_ENDPOINT=/api/remux, TRANSCODE_ENABLED=true, TRANSCODE_ENDPOINT=/api/transcode. Explicit REMUX_MODE=server still refers to the removed independent service and is intentionally not changed in this slice. Shared service still offers separate audio conversion; copy requests retain v=copy/a=copy. Existing Transcode token setting is used; private token remains outside source control.
- Added source audio choices to PlayerScreen using existing probe facts; selection changes ai on the same HLS URL and uses existing preservePlaybackState handling. Initial compatibility selection remains unchanged; ordinary player preferences can apply once choices arrive. No new remux producer/controller/timeline. Switching audio may wait for another cached/generated output, as required by the old route.
- Added bounded Matroska text sidecar operations to the existing authenticated /api/transcode handler, only for an already-admitted HLS source/plan. Reuses MkvTextSubtitles (4 readers, idle expiry, one operation per reader, 15s request timeout, existing page/index/text budgets) and client native-cue renderer/presentation settings. Subtitle media is read server-side, without browser CORS requirements for the source. Text only; bitmap formats remain unsupported; ASS/SSA uses simplified text. Unsupported/oversized/unindexed data can still hit the existing subtitle-reader limits.
- HLS FFmpeg args, event playlist, producer lifecycle, sequential disk storage, main player controller, source filtering/sorting remain unchanged. Existing HLS logs now include video/audio copy-versus-encode plan and audio ordinal, without source URL/token. Docker image includes the sidecar reader and existing relative imports; Docker Engine execution not validated.
- Found and reproduced a track registration race: Controller.play can return before a new audio HLS request has registered its job. Subtitle transport retries the specific not-ready response within a bounded 20s request budget; it never starts video work. Regression verifies this and stale response cancellation.
- Validation: build + all 1611 tests; scoped ESLint and diff checks. Actual FFmpeg fixture: two AAC tracks, English/Indonesian text subtitles, forward/back windows with original timing, no encoder and no new producer for subtitle reads. Desktop hls.js/main PlayerController and PlayerScreen track methods: choices, language switching, Off, forward/back seek and audio switch with position preservation; subtitle list remains available after audio switch. Native Safari/PWA physical acceptance still pending.
- Preview root C:/Projects/.tmp/remux-restored-server-20261030, port4175, public https://calculation-sega-reverse-mattress.trycloudflare.com/. Final artifact604a948a038e. Launcher run-restored-server-20261030.mjs in lab; old stage4 launcher is obsolete. Original client dist/server on4173 preserved. Source changes uncommitted. Lab proof files relay-tracks-real-proof.json, relay-tracks-browser-result.json, relay-tracks-full-tests.log; do not rerun one-time patch scripts.

## Server HLS overlapping manifests and duration — 2026-10-30

- User reported endless loading on audio switch with hls.js manifestLoadError HTTP429; reopening used the new audio. First-open runtime/duration was absent until reopening. Build reported 2026-10-29T20:17:28.289Z.
- Reproduced same-key concurrent manifest requests under maxConcurrent=1/perIpConcurrent=1: old code answered429 even though it should join the existing HLS producer. Cause: known checked hlsJobs AND whole-file jobs; HLS is only registered in hlsJobs. Narrow fix checks the correct map. Different work is still refused while the admission slot is occupied. No producer, command, seek controller, endpoint or audio encoding policy change.
- EVENT HLS may expose Infinity until ENDLIST. Probe already has source duration, but it was discarded by PlayerScreen. Added URL-scoped duration hint in the existing controller and fed it only from active relay source metadata. Duration remains usable before ENDLIST; another playback URL cannot inherit it; stop clears it. Client-remux duration still belongs to its existing adapter.
- Focused regressions fail before and pass after; full build and1613 tests pass. Scoped lint and diff checks pass. Browser main controller/track methods pass audio switch, two subtitle choices, Off and seeks with overlapping warmup/play manifests and host limit1. Local fixture duration45.034 is exposed from source facts. Native Safari/PWA physical retest pending.
- Public preview updated on the same port4175/tunnel, artifact4cd26ecab040; token unchanged, original client preview unchanged. No commit made. Current progress remains at the existing source checkout; retain the earlier rollback archive.

## Existing HLS alternate audio — 2026-10-30

- User authorized developing audio switching without restarting the player. Added optional alternate audio to the existing /api/transcode/hls/index.m3u8 route; no independent remux service, session endpoint or replacement playback controller. Previous working source checkpoint: lab before-multi-audio-20261030; previous single-audio verification/dist retained at C:/Projects/.tmp/remux-existing-tracks-20261030.
- Bridge health advertises alternateAudio=true. Only then does verified source metadata negotiate audios=0,1,... (2–8 unique ordinals0–7). Initial slice: AAC tracks with the same profile and device compatibility not explicitly false; mixed codecs/profiles retain existing single-audio delivery. Hoster configuration/access unchanged; no hidden audio encoding. Full transcoding remains unavailable.
- One FFmpeg input and video copy, plus one audio-only copy rendition per requested track. Files stay flat in the existing job directory: v0.m3u8/init0.mp4/seg0_* for video; v1..vN for audio. A master lists the group. Initial ai selects DEFAULT per request; group cache identity excludes ai, so changing the initial choice does not duplicate video. Token rewriting covers master AUDIO URIs, child playlists, init and fragments. Existing child route handles playlists with correct MIME and same auth/idle lifetime.
- PlayerScreen maps source metadata to the actual hls.js/native selectors; audio changes use that selector and preserve video/HLS/subtitle instances and play-request identity. Native rendition names are used when an engine reorders the track list. Stream preflight verifies a media child of a ready master. Existing subtitle sidecar, duration hints, seek/progress and presentation settings remain in use. No source filter/sort changes.
- Real progressive proof caught FFmpeg omitting the video variant from a master until EOF when source bitrate is unknown. Copy-only output receives a metadata hint to publish CODECS early; served BANDWIDTH is replaced with an explicit estimate from completed first video/audio segments plus25% headroom. Invalid FFmpeg average bitrate is omitted. This is one video variant, not an adaptive video ladder. Video/audio packet encoding remains copy.
- Cold-browser proof also caught relative HLS URLs with nested MKV source queries being classified as MKV, skipping HLS library initialization. MIME inference now resolves the outer URL against the current page; regression covers it.
- Build and all1622 tests pass, scoped ESLint/diff checks pass. Actual FFmpeg progressive fixture at4x readrate plus main controller and PlayerScreen methods: initial ai1, switch0→1→0 while advancing, same video/HLS/source/play token and subtitle session, one producer, both audio segment sets requested, forward/back seek, subtitle language switch/Off. No native Safari/PWA hardware acceptance claimed. Proof: lab multi-audio-prototype/browser-result.json and full-tests.log. FFmpeg CLI protocol and master were inspected before integration.
- Public test preview remains C:/Projects/.tmp/remux-restored-server-20261030 on4175 and https://calculation-sega-reverse-mattress.trycloudflare.com/. Artifact7f29eba07bdd; current verification root C:/Projects/.tmp/remux-multi-audio-20261030. Existing launcher/token retained; original client preview/dist untouched. Changes uncommitted. For physical acceptance close the existing stream, refresh the PWA and select a fresh multi-AAC source; an already-open single-audio playlist stays single-audio.

## Dolby audio switch fallback — 2026-10-30

- User saw Loading video / Resuming playback / Waiting for first frame when changing audio. Public server still advertises alternateAudio=true, but last production cache jobs ce117db1/b67bed6e were single-audio playlists, no master groups. Local ffprobe on each cached init.mp4 shows AVC plus EAC3 stereo for copied ordinal0/1. Thus the deployed AAC-only negotiation deliberately selected legacy reload; startup screens were a consequence, not evidence that an active alternate-audio switch rebuilt the player. A fresh console was requested before this proof; it is no longer required to establish this mechanism.
- Narrow selection fix: same-codec AC3/EAC3 groups can now negotiate existing alternate-audio HLS when device assessment does not refuse tracks. AAC still requires a common AAC profile; mixed-codec groups and unsupported codecs retain existing delivery. No producer, route, encoding policy or overlay workaround added.
- Regression fails before and passes after. Full build and1623 tests, scoped lint/diff checks pass. Real FFmpeg AC3 and EAC3 fixtures each produce two audio-only renditions plus one video copy; first packet SHA-256 matches source for both audio tracks and video. Fixture generation encoded test audio only; application proof uses copy for audio/video. Master CODECS ac-3/ec-3 verified. Existing AAC browser selector/no-reload proof remains valid; physical Dolby Safari/PWA switch acceptance still pending.
- Public preview updated on the same URL/port/token; artifact62a6a3230fb0. Test requires closing old single-audio playback, refreshing the PWA, and selecting the source again. Do not hide a real reload by suppressing startup screens. Current source remains uncommitted.

## Mixed-codec audio negotiation — 2026-10-30

- User confirmed the previous Dolby stream no longer reloads on audio selection; another source still does. A cached probe of the supplied new source read no whole movie: MKV/HEVC, duration2087.404, audio0 EAC3 stereo48000Hz Chinese, audio1 AAC-LC stereo44100Hz Japanese. Same-codec eligibility was the exact remaining restriction. The seven-track audio-renditions event elsewhere in the user log belongs to another playback; do not attribute its transient buffer stalls to the supplied mixed source.
- Existing FFmpeg multi-audio muxer already publishes both ec-3 and mp4a.40.2 in one group. RFC8216 section4.3.4.1.1 explicitly permits mixed sample formats if CODECS includes every format. Installed hls.js1.5.20 preserves comma-separated audio codecs, uses parsed init codecs for mixed variants and calls SourceBuffer.changeType for audio codec changes. No hls.js upgrade or new pipeline needed.
- Selection now accepts eligible mixed AAC/AC3/EAC3 tracks if actual SourceBuffer/ManagedSourceBuffer.changeType is available, or a native-only HLS path exposes audioTracks. Per-track device refusals remain authoritative. Different AAC profiles remain on existing delivery. Unsupported codec transition stays on the old path; it is not masked by suppressing startup screens. Trace now includes selected/source track counts, codec families and codecSwitch capability without URLs/tokens.
- Validation: real progressive EAC3@48000/AAC-LC@44100 fixture is ready in~970ms before EOF, master contains both audio codec strings, both audio first-packet SHA256 values and video first-packet SHA256 match source after copy. Build and1625 tests pass; scoped lint/diff checks pass. Local browser cannot decode EAC3 (MSE reports false), so mixed playback hardware acceptance is still pending; no spoofed decoder or claimed local seamless Dolby result. Earlier AAC browser no-reload proof remains applicable to unchanged selector/producer structure. Lab mixed-proof.json and mixed-browser-result.json record the distinction.
- Public preview updated, same URL/port4175/token, artifactbd1c1338a6e5. Close an old single-audio session, refresh PWA, and select the supplied mixed stream anew. Original client preview unchanged. Source remains uncommitted. Do not commit supplied media URLs or debrid tokens.

## Remux capability and labeling integration — 2026-10-30

- Checkpoint before expansion: 7a73252c (`feat(remux): add server audio and subtitle tracks`), including the requested 15-second background retry cooldown. No new remux-session service or replacement player was introduced.
- Client pipeline now delegates source format recognition to MediaBunny ALL_FORMATS and output codec eligibility to fragmented MP4 format capabilities. Removed AVC/AAC/stereo-only guards; selected audio is still checked against probed facts. Actual output MIME and each alternative audio MIME must pass MediaSource/ManagedMediaSource.isTypeSupported. Video-only sources can proceed without manufacturing an audio track. No encoders were added; existing source, packet, RAM, OPFS and track-count budgets remain.
- Real small generated fixtures prove packet SHA256 preservation for HEVC/EAC3 5.1 from MKV and VP9/Opus from WebM. Existing MP4 fixture proves AVC/AAC 5.1 copying; existing MKV resume/preroll proof still passes. These prove muxing/copy, not every device's decoder. Unsupported source/output combinations still report failure; source access requires CORS/ranges and metadata duration remains necessary.
- Server alternate audio no longer has an AAC/AC3/EAC3 codec whitelist. Device refusals and actual codec/profile transition support still apply. Existing FFmpeg copy/HLS producer and audio-only encoding path are unchanged; full video transcoding and client transcoding remain unavailable. The audio-conversion badge reads orange Transcoding.
- Explicit REMUX_MODE=server now invokes the existing relay when its endpoint is configured. Docker Compose now propagates REMUX_MODE and REMUX_CLIENT_CACHE_MAX_MIB; legacy absent mode stays compatible. Client remux availability is determined from secure-context/MSE/worker/OPFS APIs, independently of server endpoint availability. Environment documentation explains modes, storage and server assistance/privacy. Token input moved from General into Playback / Audio & Video; storage/action unchanged.
- Selecting a stream cancels active network/worker probes and queued labeling before checking only the selected file (15-second bound). Completed facts survive cancellation. Generation guards prevent stale probes/rapid selections from changing the new attempt. Cancelled labeling is not counted as a failure. Ready HLS/DASH and already prepared relay sources skip file probing. Failure ends the loading overlay and offers a clear retry message rather than handing an unprobed MKV directly to the browser.
- Metadata filename fallback is opt-in via metadataFilenameFallback (default false) in Audio & Video. It applies after metadata failure or an Unknown metadata verdict, not while the initial check is pending. Filename results retain estimate marking and a tappable/keyboard-accessible circled !; its explanation includes a sanitized failure category. Labels do not authorize conversion or change connected-server filters/sorting. A later successful probe replaces the estimate. Background failure retries once after at least 15 seconds; timers stop on selection/cleanup.
- Latest verification build asset a2a177325d4e in C:/Projects/.tmp/remux-multi-audio-20261030; build, scoped ESLint and all1636 tests pass there. Source checkout's original client dist remains unchanged as the earlier comparison build. No native iPhone/iPad acceptance is claimed for this expansion yet.
- Merge preparation: development is 31 commits ahead of this branch's common ancestor; inspect merge conflicts in isolation and validate the resulting tree before advancing development. Physical acceptance remains the gate before merging the expanded playback behavior.

## Isolated development integration candidate — 2026-10-30

- Feature integration commit: 6f106818, clean on experiment/movi-engine. Isolated candidate is codex/remux-development-integration at C:/Projects/.tmp/remux-development-20261030, merging development fca32500. Main development checkout has a local desktopMediaHoverPreview.js change and untracked tools; neither was touched or included.
- Resolved four textual conflicts: append independent player and desktop-frame CSS sections, preserve both stream cleanup lifecycles, retain MDBList environment documentation, and combine MDBList with existing probe/remux/audio/IntroDB local server handlers. No connected-server sorting/filter policy was edited.
- Automatic merge retained an obsolete desktop image tag on the added transcode bridge. Removed it to match development release policy; release distribution regression now includes transcode as the sixth bridge/frontend tag block.
- Candidate build asset4e8b8d9ac842 and all1660 tests pass, using the same ignored local.properties configuration as the feature checkout. Source feature client comparison dist remains untouched. Device acceptance of the expanded remux routes and fallback UI is still required before advancing experiment/development refs. Do not commit local.properties or preview access tokens.

## Server acceptance feedback: attachment probe overflow — 2026-10-30

- User confirmed feedback is from server mode. Supplied MKV has H264, EAC3 stereo, duration1544.62 and25 attachment streams plus text subtitles. Existing endpoint returned502/probe-unreadable. Independent metadata-only ffprobe returned valid facts; full show_data output exceeded16MiB and the old handler retained only the first256KiB, producing invalid JSON. This is an internal metadata collection failure, not evidence of an upstream502 or unremuxable source.
- Single-pass collector now discards non-video extradata string payloads incrementally (fonts, attachment/audio/subtitle dumps) while preserving JSON structure and actual video decoder configuration. Retained metadata stays under the existing256Ki-character budget; overflow fails explicitly instead of truncating. No larger whole-file buffer, second ffprobe pass, new playback route, encoder or codec restriction was added.
- Actual supplied source through fixed handler: HTTP200 in6260ms, MKV/H264/EAC3 stereo, duration1544.62, avc1.640032. Do not generalize this proof to every failed source. Regression feeds32MiB attachment text in chunks, verifies bounded retained output, escape handling, video config preservation and valid normalized metadata.
- Server failure cache shortened from2minutes to15seconds to match the requested retry interval; cached/joined errors preserve their reason. Client UI accepts only known server error categories, so a probe502 is no longer presented as if it were the source's HTTP response.
- Checking now uses the same movie title/logo/backdrop/item identity as player loading. Fallback circled! replaces the visible estimate suffix (ordinary filename labeling retains estimate). Token has its own Server access subsection inside Playback/Audio & Video; value/storage unchanged.
- Build asset657fdc1cb329, scoped lint and all1665 tests pass. Follow-up stays on the isolated integration candidate; development main checkout and its local changes remain untouched. Refresh the existing server preview for device acceptance.

## Unverified playback is allowed — 2026-11-01

- User approved: failed/Unknown probing must not block manual Play. Remux filename estimates select an initial copy-only attempt in the configured hoster mode. Direct/Unknown/estimated audio-conversion labels try the original URL; estimates never authorize audio/video encoding. Verified file facts retain the previous policy.
- Known labeling failures are not obligatorily probed again on each Play within the list session. A new selected-stream check may still run when none has finished/failed, but failure now continues to the player instead of rejecting it. Existing label/filter/sort behavior is unchanged.
- A dedicated per-play attempt record follows the source URL and route. Native format/decoder startup errors (3/4 or explicit unsupported-format error) may start one configured copy-remux attempt. Explicit HTTP access/server errors, network/abort/autoplay failures and generic stalls do not automatically remux. It never starts audio or video encoding. Both native media errors and play rejection reuse the same guarded attempt; stale preparation cannot override a newly selected source.
- After remux failure, existing error overlay exposes Try original URL and Try again; choosing raw preserves the automatic-remux-used guard. Back still chooses another source. Error details retain probe reason alongside the actual playback failure. Manual retry is explicit; there is no automatic route loop. Keyboard Tab can reach the additional error actions.
- Client copy attempts use the existing runtime with no synthetic codec facts; server attempts use the existing HLS copy plan (v=copy/a=copy) or its legacy file delivery. No new media-service route/controller was introduced.
- Build asset331a6362c860, scoped lint and all1675 tests pass. Focused proof includes failed metadata navigation, no repeated known-failure probe, initial route selection, no encoder requests, duplicate error suppression, no route loop, stale-source protection and manual raw retry.
- Follow-up questions verified from current code: client source-byte cap remains13MiB, adaptive reads256KiB up to1MiB stop as soon as complete metadata is returned; native server has a20s process timeout and an assumed10MiB cost accounting value, not a real source-byte download cap. Server output collector256Ki-character bound is separate. Stream-list server probing starts5 rows per batch and renders individual answers with UI coalescing; client1 or configured staged2 workers. Client WASM still prints attachment extradata, so do not claim it has the server streaming-output fix.
- Both old public quick-tunnel hostnames returned DNS ENOTFOUND on Nov1 while local4175/4176 answered200. Replacement tunnel uses HTTP2; do not attribute earlier client502 to a codec or metadata issue without the requested console/URL. Source remains on isolated integration candidate, with physical acceptance pending and development unchanged.

## Client early selection: late URL and large attachments — 2026-11-01

- User iPhone log build05:12:11.741 shows native-file startup-stall/readyState0. Before failure the route log says source kind=none; later native NotSupportedError/mediaError4 follows. Code proof: a raw TB Instant row selected before background URL preparation leaves StreamScreen with no URL, so route planning is skipped. Player resolves the debrid URL later in playStreamCandidate and previously sent it straight to native playback. Server background bulk resolution often masks the same ordering problem; do not describe it as an iPhone hardware limit.
- Player now prepares the playback route after candidate URL resolution, before calling playStreamByUrl. Known client remux plans and Unknown/estimated attempts are assigned to the real URL; configured server copy preserves the chosen audio ordinal. Candidate generations suppress stale resolution; preparation errors render the actual startup error. Regression follows a descriptor with no URL through resolver success and checks the client remux plan exists before playback.
- Log probe timing is separate: one source hits13MiB at12570ms cold/5836ms warm; another succeeds after7193610bytes at6911ms. Cold WASM initialization cost3954ms. No502 appears in those client probe events (Range206/CORS). Supplied URL has a different signed sourceId, so do not attribute either logged byte count to that exact URL without stable identity evidence.
- Independent bounded MediaBunny preflight on the supplied URL reproduced range-read-limit after81397bytes: pinned1.62.1 eagerly requests an Attachments element from21760 to46354697 (~46MB). No read/RAM limit was raised. Remux-only esbuild policy omits eager attachment/font/artwork loading in the pinned Matroska demuxer. Node_modules remains unchanged; the transformation fails closed if the version/anchors change. The policy source participates in the immutable asset hash; modified demuxer source is emitted beside the existing license. Encoded tracks and the separate text-subtitle reader are unchanged.
- Same URL after policy: AVC/AAC stereo, duration1544.62, output MIME video/mp4 codecs avc1.640028/mp4a.40.2. Metadata/key-packet preflight read1836629bytes/7requests, tracks ready1388ms, maximum read1521966bytes on local Node network. This proves source reading, not iPhone decode or whole-movie playback. Stopped before producing full media. Original pipeline still rejects the oversized fixture; adapted real worker pipeline skips a9MiB font, reads under512KiB and preserves video/audio packet SHA256 from the selected preroll.
- Build asset7f956a9e6a18, lint and all1678 tests pass. Client label WASM remains bounded13MiB and is not replaced; huge-attachment sources can still need a filename/Unknown label even though the remux reader can now open them. Both current public server/client URLs answered200 before deployment. Physical acceptance and advancement of development remain pending.

## Truthful Checking, bounded failure memory and manual remux — 2026-11-01

- User confirmed filename fallback is intentionally OFF. Latest log build05:36:44.214 has resolved route=direct, native-file startup-stall/readyState0/code0. This is not a confirmed format error, so the previously approved automatic Direct→copy guard intentionally does not run. Do not change the fallback-label preference to force remux or diagnose hardware from this log.
- User clarified the card never leaves Checking, not Unknown. Found concrete UI bug: StreamScreen used (pending || streamProber.enabled), so a candidate waiting for a debrid URL or not actually being processed appeared Checking solely because probing was enabled. Removed enabled as a pending-work signal. Actual pending requests still show Checking; unanswered/non-running and failed rows show Unknown when filename fallback is off. Full card-render regression covers idle→pending→failed.
- Successful probe cache demonstrably worked: source s67f74bbc label appeared with no ClientProbe request in the new log. Other logged sources s3ec18bb6 and s4ff5061f repeatedly failed at13631488bytes; those had no successful metadata to cache. User-supplied new signed URL hashes to s27c7d4ac, absent from the log probe events, so do not equate it with the other logged file IDs without stable identity evidence.
- Deterministic client probe-byte-budget failures now have bounded shared PAGE-MEMORY retention10minutes across prober instances/navigation, keyed by existing stable torrent-file identity when available (URL otherwise). Max1000 entries; expiry or metadata-cache generation reset allows a new attempt. Positive RAM/IndexedDB file facts take precedence. Failures remain null/Unknown, never fabricated file facts. Network/transient failures remain retryable on the existing15-second schedule. Full page reload clears this failure memory; persistent successful metadata remains30days for strong hash+file-index identities, not episode title.
- Existing startup-error UI offers manual Try remux when an unverified Direct attempt has not tried the configured copy route. Manual choice reuses the copy-only path and the one-auto-attempt guard; no encoder or automatic remux-on-ambiguous-stall was added. Existing original URL/retry/back choices remain.
- Opt-in ClientProbe cache-hit diagnostics report memory/persistent/byte-limit-failure tier and opaque sourceId only. No URLs/tokens/filenames. Build asset1261f4722d4d, lint and all1682 tests pass. Physical client acceptance and development advancement are still pending.

## Client attachment probe and shared preview labels — 2026-11-01

- User requested a fix after the previous idle→Unknown change made more rows appear failed. Shared StreamScreen and in-player badges now show Waiting before work, Checking while pending, Unknown after failure, then the actual playback method on success. Filename fallback remains intentionally OFF. Both client/server previews receive the same frontend changes, with their existing different probe/remux modes preserved.
- Client ffprobe now uses a metadata-only sparse Matroska view: bounded structural Segment/SeekHead parsing locates Attachments headers and overlays same-length EBML Void headers. It never rewrites packet patterns, changes offsets or source bytes, fabricates missing media, increases13MiB budget, or affects the remux/subtitle reader. Malformed/non-MKV or unrecognized layouts retain previous bounded behavior.
- Real WASM regression with18MiB font reproduces the original13MiB failure, then succeeds below1MiB using the view, preserving H264 and both6/2-channel audio tracks. Tests cover SeekHead targets after Cluster, split headers, malformed input, unchanged original bytes and sparse missing-byte failures.
- Bounded real-source check on the previously supplied attachment-heavy MKV: ffprobe WASM succeeds with1295805bytes/5requests, one attachment omitted, AVC/AAC,1847ms on local network. This is metadata proof, not an iPhone playback or cold WASM timing claim.
- Preview tracked code matched bee8b70a after normalizing Windows line endings; there was no separate server-only edit to overwrite. Development advancement and physical acceptance remain pending.

- Final validation: scoped lint/build pass; all1687 tests pass, assetfdcfd11af02c. Both previews use the same code checkpoint; server/client deployment mode stays distinct.

## Automatic unverified playback ladder — 2026-11-01

- User approved Direct→configured remux→server audio conversion for unverified playback, requested removal of Try remux, and explicitly requested application to both client/server previews. Filename fallback stays a label preference; it is not silently enabled. Known metadata routing stays unchanged.
- Unverified Direct startup now has an absolute15-second deadline from initial loading, including metadata waiting. A format refusal can trigger copy earlier. The startup guard invokes the same fallback as native error/play rejection before showing an error. Explicit network/access/HTTP failures, abort/autoplay refusals, presented playback and repeated route attempts remain excluded. The former60-second metadata budget remains for verified playback, not unverified Direct with an available remux mode.
- A failed unverified remux may inspect actual source metadata once when a server audio endpoint is configured. Existing capability classification and buildTranscodePlan must confirm audio-only conversion, including supported video. Unknown facts, unsupported video, an already playable alternative audio track, inaccessible service or missing required token never authorize encoding. Existing server URL builders produce video=copy/audio=AAC only. Client mode never encodes and a deployment without the server endpoint never starts this audio fallback. The fallback prober is bounded15seconds and cancelled on cleanup/new mount.
- Route reservations suppress duplicate native/error/timer events; pending resume is preserved and stale asynchronous results cannot replace newly selected playback. Explicit original-URL/retry remain; Try remux action/button are removed. Diagnostic fallback messages contain route names only.
- Tests cover client/server copy fallback,15-second absolute startup deadline, actual timer dispatch before error UI, network/access exclusions, audio-only evidence/access guards, single-use audio fallback, stale-source suppression and restore preservation. No new relay service/player or full/client transcoding was introduced.

- Final validation: scoped lint and build pass; all1694 tests pass. Build2026-11-01T06:37:03.347Z, asset7ab4e40916a8. Both preview modes are updated together; physical acceptance and development advancement remain pending.

## URL-less client label queue and cache-first identity — 2026-11-01

- User configured10 probes but observed only2 then4 labels after leaving/reopening. Logs show persistent/memory hits for those four, not failed media probes for the other six. Do not claim all six URLs are unavailable: prior code filtered URL-less rows out before invoking the prober. Client resolveUnknownRows intentionally skipped bulk URL preparation and relied on separate Instant Playback preparation, which has its own limit/budgets. Thus label cap10 did not ensure all10 candidates entered work. Cache lookup also required a source URL before considering stable identity.
- Client createStreamProber now allows an empty-source, strong torrent-file identity cache-only lookup. Positive RAM/IndexedDB facts are reassessed normally; misses never invoke WASM/network or negative-cache a nonexistent URL. Cache-generation and150ms database lookup deadline are preserved. Strong identities remain hash+file-index; title-only reuse is forbidden.
- Shared probeStreamCandidate checks identity cache first, then obtains an actual URL through the existing resolver for a cache-missing candidate when its probe slot runs. Resolver waiting is bounded15seconds. Caller generation/mount guards suppress stale list writes and late media starts. No bulk pre-resolution barrier was added to client labeling. Existing server route, client1/staged2 concurrency, label caps, filters/sorting, Instant Playback preparation limits and media byte/RAM budgets remain.
- Stream list queue now admits URL-less client rows, records pending/failure status under stable/raw keys, updates resolved URLs and keeps URL-less failures terminal. Player Sources uses the same helper and preserves result/pending keys across URL resolution. Regressions cover10 raw candidates with4 cached/6 fresh, cache-only miss then real probe, client/server resolver context, timeout/failure/stale results and10 unresolvable UI rows ending Unknown with no pending work.
- Earlier log also shows Direct→client-remux automatic fallback working. That attempt's source host was github.com and the probe failed before receiving source bytes; do not infer successful video playback from the transition log alone. Physical acceptance and development advancement remain pending.

- Final validation: scoped lint/build pass; all1700 tests pass. Build2026-11-01T06:46:58.492Z, asset4e9931e2348c. Both preview modes updated together; development advancement remains pending physical acceptance.

## Two-worker client preview and independent server lanes — 2026-11-01

- User confirms all10 client candidates now complete after9bec8563. They explicitly request2 client workers and analogous server queue fixes. Local preview launcher now sets PROBE_CLIENT_CONCURRENCY=2 for client (server value1 is unused for server probe execution). It remains mode=client with no server media/encoding endpoint. Existing staged startup publishes a first successful result before parallel WASM, then uses two independent lanes; positive cache hits need no worker. Production defaults are not changed by a local preview choice.
- Audit found server scheduleUnknownProbes still waited for whole-list resolveUnknownRows before starting any probe; server batches also awaited all five peers before starting the next group. Scheduling now goes directly to the existing bounded candidate helper. URL-less server candidates enter work and reach a terminal result/failure instead of being skipped. Five independent server lanes refill as soon as a slot finishes; client1/staged2 behavior and candidate caps remain. No service/HLS/FFmpeg path, source filter or sorting changes.
- Focused regressions cover server scheduling despite an unresolved bulk-preparation stub, eight candidates continuing while the first request is held with concurrency at most5, and10 URL-less server candidates reaching terminal failures. Existing two-worker tests prove staged warm-up and independent client lanes.
- Shared-preview source checkpoint is updated for both modes; client preview process must be restarted from its verified4176 process record so runtime env exposes2. Public client/server modes and bundle hashes are checked after deployment. Development advancement remains pending final physical acceptance.

- Final validation: scoped lint/build pass; all1703 tests pass. Build2026-11-01T06:54:23.945Z, asset0f1ae588a866. Browser test storage is isolated so URL-less resolver fixtures do not emit data-URL stack traces.

## Applied labeling/filter/autoplay audit — 2026-11-01

- User approved applying the two-pass audit after examples/explanations. Changes remain on codex/remux-development-integration, not development. No connected-server filter/sorting or remux/transcode media-service changes.
- Shared autoPlayCandidates enforces source permissions and regex before binge preference, preserves the existing HDR rules, and keeps Manual inactive. Explicit Auto Next can select while initial mode is Manual, retaining addon/plugin permissions; Prefer Binge Group alone no longer activates selection. Reuse Last Link must pass current source/regex/compatibility eligibility.
- New inspectAutoPlayStreams uses the existing probeStreamCandidate cache/URL reader for detail and next-episode compatibility selection. It preserves source order and binge context, respects one deadline, cancels owned probing at expiry, and stops when the highest-priority eligible candidate is confirmed. Actual metadata, including strong-identity cache hits without a signed URL, travels into StreamScreen/player/next handoffs. No filename guess authorizes encoding.
- Background addon/quota choices now bound background work only. Filters recognize existing metadata from any source/candidate; filename-mode filters remain local estimates. Playback badge visibility remains independent. Check enablement gates the compatibility filter even without background addons. Known results can display outside the background quota. Settings descriptions explain background scope, known results, estimates and player metadata reading.
- Initial Instant now has the same45-second safety budget as next episode instead of a zero-ms deadline. Unlimited cannot return on partial discovery. Numeric budgets carry across stages without the stream screen's former extra5/120-second wait. A collected source at discovery deadline is retained only when applicable compatibility checks can still be satisfied; stale/late results cannot select a different file. Direct startup's15-second fallback remains separate.
- Stream route snapshots retain matching probe facts with cache-generation protection. Cache-only client hydration reads known strong identities outside the background cap in10 storage lanes (max1000); no debrid/media/WASM work is initiated by this read. This fixes re-hidden known sources after returning from the player. User playback selection suppresses background autoplay races.
- Added regressions reproduce/fix Instant/Unlimited, source/regex versus binge, Manual/Auto Next permissions, known facts outside background scope, URL-less cache selection, remembered-link eligibility, binge retention after inspection and identity-based/Back handoffs. Existing tests were adjusted where they deliberately asserted old addon-scope-as-filter behavior; surrounding HDR/deadline/source permission tests remain required.

- Follow-up coverage found a third entry point: stream-picker autoplay could still depend on cosmetic background scope. It now invokes the same selected-candidate inspection when no eligible known result exists, with one inherited deadline and explicit preemption of background work. Interrupted pending background rows are removed from the sent set, metadata survives, and a manual selection invalidates the automatic result. Candidate/settings signatures prevent loops while allowing a genuinely new discovery revision.

- Final validation: scoped ESLint/build pass; all1715 tests pass. Build2026-11-01T11:00:31.009Z, asset42438d13bccb. Regression also preserves later addon arrivals/current row fields and rejects results after manual selection. Both previews retain their runtime modes (client2 workers, server5 lanes); physical acceptance and development advancement remain pending.

## Verified partial initial discovery follow-up — 2026-11-01

- Final review of bb01eea9 found a related incomplete initial-handoff case: a raw first arrival could end source discovery before the compatibility pass rejected it. Initial discovery now accepts an optional owned compatibility verifier while addon chunks keep arriving. It tracks revisions, carries actual facts between passes, retains later rows/URLs and releases Instant only on a verified match. Unlimited waits for a verified complete revision. Unexpected verifier failure marks the revision checked and cannot busy-loop or choose the unverified raw candidate.
- Detail passes the shared inspector as its verifier and does not repeat an already completed verification pass. Selected-file probing uses the host candidate cap (client safety maximum20), not the cosmetic background quota. A background limit3 can therefore coexist with an allowed fourth selected candidate; source permissions remain mandatory. Added regressions cover rejected first raw arrival followed by a compatible later addon, Unlimited full revision with facts handoff, and verifier failure without unverified fallback.

- Follow-up final validation: scoped lint/build pass; all1718 tests pass. Build2026-11-01T11:08:24.028Z, asset80d0dff58804. Current preview acceptance remains pending on physical client/server devices.

## Selected-source playback simplification — 2026-11-01

This supersedes the earlier list-labeling/compatibility audit above.

- User approved removing media checks from stream lists (manual and autoplay), deferring playback labels, and deciding delivery only after one source is selected. Removed background queues, list-wide cache hydration, compatibility preflight, label rendering, and the related Audio & Video / Fusion controls. Legacy synchronized preferences remain readable for profile compatibility but cannot hide sources, trigger probes, or authorize filename-based playback routes. Imported appearance/size badges and connected-server filters/sorting are unchanged.
- Player owns the selected source: resolve URL, reuse/read bounded metadata through the existing client/server reader, then choose Direct/copy remux/server audio-only conversion using actual device capability. Prepared HLS/DASH skips file probing. Unreadable metadata permits Direct followed by the existing configured-copy/evidence-gated audio fallback. No client encoding, video encoding, new relay route, or media engine.
- Extracted the established HLS/alternate-audio delivery methods into selectedStreamDelivery.js; producer and rendition selection are retained. selectedPlaybackTask bounds preparatory waiting and responds immediately to Back. Reader/media work stops on Back/reselection; stale results cannot replace the current source.
- Manual terminal startup/processing failures return to the picker with a notice. Autoplay tries stable file identities once, respecting current addon/plugin/regex/HDR/binge rules, fetches later candidates after partial discovery when needed, and opens a manual picker on exhaustion. Known shared processing outages suppress repeated processing attempts while Direct remains eligible. Explicit source choices stay manual after previous autoplay.
- Visible Back spans unified and alternative loading surfaces, including Continue Watching and next-episode discovery. Back disables deferred automatic launch and cancels discovery waiting before returning. Failed preparation while manually switching sources follows the same picker-return rule. Mid-playback error behavior outside startup is preserved.
- Retired tests for removed list behavior; retained metadata-budget/cache/worker, transport, remux, audio/subtitle, source permissions and navigation coverage. Added selected-source/cancellation/autoplay regressions; moved existing alternate-audio HLS preflight regression to its new owner.
- Validation: build asset b6458506dc89, scoped ESLint/build and all1652 tests pass. Uncommitted changes remain on codex/remux-development-integration (base89b93012); development and experiment refs are unchanged. Physical acceptance pending. User explicitly approved updating both public test frontends after the publication approval review requested clarification.

## Filename-only labels/filter and fast startup routing — 2026-11-01

This supersedes label deferral and mandatory selected-source startup probing. User explicitly approved filename-based initial Direct/remux/server-audio decisions with a default-on Audio & Video preference.

- Fusion Style now offers Filename playback labels. Labels are local filename/device estimates (Direct, Remux, audio Transcoding, video Unsupported, Unknown), with an estimate mark and accessible explanation. They appear first in the existing badge row, before size/imported badges at either TOP/BOTTOM placement. Cached metadata never replaces a filename label.
- Audio & Video offers All streams / Direct / Direct + Remux, with a caution that incomplete/wrong filenames can hide playable and Unknown rows. New profile-scoped filenameStreamDisplayMode defaults ALL without reviving retired metadata settings. One local policy serves stream lists, saved-link reuse, initial autoplay, retry selection, next episodes, source switching, player/episode/detail panels and season stream selection. Source/addon/plugin/regex/HDR/binge restrictions remain mandatory; no-match cannot fall through to a hidden first row. Canonical fetched lists are retained; connected-server filter/sort code is unchanged. Label visibility is independent of filtering; no list probing was restored.
- Audio & Video also offers Choose playback route from filename (filenamePlaybackRoutingEnabled, default true). It can immediately start Direct, configured copy remux or server AAC audio conversion from the estimate; existing actual facts are preferred if already available. No separate startup ffprobe/WASM request is mandatory. Ready manifest/prepared deliveries retain their established path; actual remux demuxing and selected audio/subtitle discovery still read the source when needed.
- Off means Direct first, configured remux next, then supported server audio conversion. Without filename permission, audio conversion still requires actual selected-source facts/device evidence. With permission, a filename audio-only estimate can request video=copy/audio=AAC. Video encoding and client encoding remain unavailable. Unknown/unsupported-video estimates start Direct rather than authorize video encoding. Known playable alternative audio can be copied; known multi-audio rendition facts are reused.
- Fallback records tried routes, coalesces duplicate failures and tries remaining supported routes without loops. Direct startup15s, processed startup30s, preparation30s. Known source access/network/autoplay refusals do not cause futile conversions; a processing-service refusal can still try an untried original URL. Back aborts work and suppresses late playback/errors. Relay URL generation guards stop superseded jobs replacing the current route. Exhaustion preserves manual-return/autoplay-next behavior.
- Validation: scoped ESLint/build and all1674 tests pass; asset fe490e0a54b9. Tests cover defaults, filter parity, badge ordering, label/filter independence, no background probing, actual player fallback and cancellation, finite routes, and video-copy audio plans. Changes remain uncommitted on codex/remux-development-integration/base89b93012. No development/experiment refs changed. Physical acceptance pending. User explicitly approved publication of this exact build. Both public frontends now serve asset fe490e0a54b9 (HTTP200, matching bundle SHA256, correct client/server runtime modes). Client has no audio-server endpoint. Physical acceptance remains pending.


## Episode drawer and server HLS recovery — 2026-11-02

- Removed the final deleted renderPlayerStreamLabel call from browser episode-source cards. It threw while rendering the open drawer, leaving an invisible input-blocking panel. A regression renders real episode-stream markup, including loaded, loading and empty states.
- Automatic route admission now refuses an already-tried route at the execution boundary; explicit user retries remain available. Regressions cover duplicate Direct entry and processing-service 502 followed by a single Direct attempt and exhaustion. The exact origin of the repeated Direct calls in the device log has not been reproduced; the boundary invariant is now enforced.
- Existing HLS delivery recreates completed jobs when their cached playlist disappeared, including normal admission limits for replacement work. An unfinished producer returns 503/Retry-After rather than a false 502. Completed output without media remains a failure. Playlist completion is sampled before asynchronous reading to avoid rejecting a file written during an in-flight read.
- No new delivery route, video/client encoding, list probing, or connected-server filter/sort changes. The user-supplied H.264/E-AC3 MKV was readable by ffprobe and produced HLS through the existing bridge in an isolated localhost diagnostic. The public server returned 502 for the same source; no device-level acceptance is claimed yet.

Validation: build ea94f11d41ae and scoped ESLint pass; all 1681 tests pass with test-concurrency=4. Both public test frontends serve the matching bundle (HTTP 200), with client/server runtime modes preserved and no client audio-server endpoint. Existing server preview updated with the HLS handler fix; user-supplied source returned HTTP 200 with one ready segment in 5777ms after restart. Physical drawer/playback acceptance remains pending; no commit or branch merge was made.


## Accepted preview and single-branch workflow — 2026-11-02

User confirmed both client and server tests are working after the episode drawer/HLS fixes. Build ea94f11d41ae, scoped ESLint and all 1681 tests passed. Preview listeners now accept LAN/Tailscale access as requested; runtime-only launcher configuration and tokens remain outside Git.

User authorized committing the completed integration and chose development as the only branch for subsequent work, at C:/Projects/NuvioWeb-development. The integration history already contains development/fca32500, allowing a fast-forward. Preserve the existing uncommitted desktopMediaHoverPreview.js edit and tools/preview-iphone.mjs in that checkout. Existing experiment/movi-engine (6f106818) and integration branches remain as historical references; do not delete or continue feature work there. No remote push was requested.

## Settings content layout trial — 2026-11-02

Uncommitted on development, C:/Projects/NuvioWeb-development. User approved applying the responsive Settings content proposal, especially open/close Playback topics on mobile. Preserve Back, heading/title, navbar and page background exactly. No commit or push requested.

Advanced browser Playback now has seven topics: General, Autoplay, Audio & Video, Subtitles, Skip segments, External player, P2P Streaming. Mobile/tablet below 960px use an exclusive accordion with summaries of saved values; wider screens use keyboard-accessible tabs. TV retains its existing four groups and Essential mode retains its existing content. Existing conditional fields, actions and profile/host restrictions are retained; all 53 original literal Playback focus keys remain present. No playback routing or connected-server filtering/sorting changes.

Audio languages are presented as primary/fallback cards, filename filtering has concise guidance and a warning, and server access remains endpoint-gated. Subtitles has a local appearance preview using saved style. Fusion Style and Audio & Video have display-only source-card previews using existing renderer/device/filter logic and static filenames without URLs; no media fetch, probe or player is created. Shared browser switches now expose their state to assistive tools. Updated obsolete metadata cache/selection-timeout copy in English/Indonesian.

Validation: asset build 907d781fbb0f; scoped ESLint, git diff --check, and all 1687 tests pass (test-concurrency=4). Isolated Edge UI checks at 390/834/1440px prove exact protected-shell geometry/style equality, one open topic, current summaries, saved-style preview changes, label visibility changes, desktop arrow navigation and no media processing requests. Original protected header overflow at tablet width remains outside scope. Evidence: settings-implementation-qa.json and settings-applied-*.png in the conversation visualization directory. Local review server is 127.0.0.1:4180. Physical iPhone/PWA acceptance remains for user review. Preserve unrelated desktopMediaHoverPreview.js and tools/preview-iphone.mjs changes.

### Selected appearance: separate accordion cards
User selected Kartu terpisah. Applied only below 960px: individual 18px cards, topic icons from existing Material Icons, 12px gaps, active card border/inverted icon, inset body spacing. Desktop tabs and protected shell remain unchanged. Build 91596131d16b, scoped ESLint/diff checks and 20 focused tests pass; browser QA at 390/834/1440px including resize passes again. Both existing preview frontends updated; no commit/push.

### Wide desktop Playback correction
User screenshot showed the 960px content column stuck to the left on a 1920px screen. Content now centers at max 1400px from 960px upward; from 1200px standard topic controls form two columns of bounded cards, while Audio & Video and Subtitles place their display-only previews beside controls. Existing tab navigation, protected Back/title/nav/background, and narrow accordion cards remain. Audio preview moved outside controls wrapper so desktop columns can place it independently. No storage, action, playback or server changes. Build f6d149b6499a; scoped ESLint/diff checks and 20 focused tests pass. Browser QA at 390/834/1440/1920px confirms centered content, two-column controls, exact protected-shell equality, previews, keyboard/resize and no media requests. Both preview frontends updated; still uncommitted.

### Settings card theme tint
User requested a touch of their selected color on Settings section cards. Added browser-only accent wash (9% to 2.5%), 24% accent borders, and stronger open accordion edge/icon, using existing secondary-color tokens rather than focus tokens that pointer interactions clear. Covers Settings group/subsection cards, Playback cards/language choices and stream preview; does not target page background, heading, navigation, subtitle sample or theme swatches. Theme changes apply through existing CSS tokens without new preference or code path. Build dbd6056402ad passes build/diff checks. Real appearance picker tests with OCEAN and EMERALD on 390px/1920px prove wash and border follow selected palette while text stays white. Responsive/protected-shell checks at 390/834/1440/1920px pass. Both previews updated; uncommitted.

### Responsive Settings index + section panels
User requested a combined category/index and section view for desktops/large tablets while retaining separate pages for phones/small tablets. Implemented browser-only panel presentation at min-width 1024px. Both existing canonical routes and all Router navigation/Back behavior stay unchanged; wide screens reveal the category list beside the existing section. The index presents its first permitted section without changing its route or activeSection; presentedSectionId only marks the visible category. The section heading spans above both panels, preserving original Back/title/nav/background geometry/styles. Narrow screens retain original index/section visibility and accordion cards.

The 1024px query listener belongs to each screen instance and redraws only its current route; resize/rotation never navigates, modifies history, or redirects to another screen. Cleanup removes the listener. Wide markup wraps body nodes while retaining the same content container, actions and dialog targets. Wide CSS compacts category rows and allows their panel to scroll independently. TV remains untouched. No new preference or dependency. Existing unrelated hover-preview/tools changes preserved.

Validation: build 7634be54c6a5; scoped ESLint and diff checks pass; full suite 1689/1689, followed by 22/22 focused checks after final CSS-only refinement. Isolated Edge UI evidence settings-panels-qa.json/screenshots at 390,834,1023,1024,1440,1920px proves correct layout boundary, non-overlapping panels, selected category, controls after round-trip resize, unchanged history on resize, Back to index, native browser Forward/Back, opening another category and scrolling to Advanced. Protected shell equality matches earlier baselines at 390/834/1440/1920px. UI scripts await committed browser history (not merely route mount), avoiding a startup automation race. Both existing client/server test frontends updated, tokens/backend unchanged. Physical tablet/PWA acceptance remains user review. Uncommitted; no push or branch creation.

### Left panel group shrink/clipping fix
User screenshots exposed collapsed category group boxes after limiting sidebar height. Reproduced on 1024x768,1440x900,1920x910: all five groups clipped their rows; index also retained page-only first/last row corners and separators. Browser panel CSS now prevents direct sidebar children/groups shrinking, allows group content overflow, and resets grouped row borders/radii/selection to the same panel presentation on both routes. Only the outer sidebar scrolls. Narrow layout unchanged. Build 47561401ba79 and diff check pass. Geometry regression checks both index and section: zero clipped groups, zero sibling collisions, rows >=48px, all corners10px, outer scrolling and About reachable. Existing six-width Back/Forward/resize/protected-shell UI regression passes again. Both previews updated, uncommitted.

## Approved Content & Discovery redesign — 2026-11-02
User approved the Content & Discovery proposal and explicitly requires one section at a time. Implemented ONLY this section; do not start Layout/Fusion Style/Integrations redesign without the next approval.

Browser Discovery now uses Addons/Plugins/Collections tabs at >=1024px and separate exclusive accordion cards below that, matching the approved device distinction. Counts come from existing local repository/store getters, not new decoration fetches. Essential mode excludes Plugins and cannot select that topic. TV keeps its original Addons/Plugins action rows and navigation. Existing Settings routes, Back/title/navbar/background and theme-tinted panels remain.

Reuses the three existing managers, their stores, profile/device scope, enable switches, addon refresh/removal confirmation/drag order, plugin URL template variables, collection editor and delete confirmation. Add/create forms now use native details disclosures; managers retain draft values/open state across topic switching/resizing. Successful submits clear and close forms. Addons refresh manifests on first opening, while subsequent tab changes reuse local configured records. Browser manager flags/bindings refer only to the active topic; tab keyboard arrows/Home/End follow the same loading path. Obsolete unreachable browser collapsible markup was removed from the TV render branch.

Back from the existing collection editor resumes the retained Settings DOM without mounting it again. Added a guarded onRouteRevealed hook for the visible Discovery page and local collection reread when rendering, so new/edited collections appear immediately. No router changes or forced addon reload on return. New contentDiscoveryPresentation helper owns valid topic/Essential selection; six regression tests cover selection, disclosure/drafts, local addon reload, existing plugin/collection mutations and reveal guard.

Validation: build a0a277828974, scoped ESLint/diff checks pass. Full suite 1695/1695; final form-close/copy/CSS refinements followed by 10/10 focused tests. Isolated guest Edge UI at 390/1920px uses an intercepted fixture manifest, not the user's account: addon install/enable/remove-cancel, draft preservation for all three managers, plugin add/device enable, collection create/editor/native Back, responsive round trip with unchanged history, actual addon drag/reorder and no overflow/errors pass. Essential UI proves only Addons/Collections remain. Existing six-width panel Back/Forward/resize/protected-shell regression passes. Evidence discovery-implementation-qa.json, discovery-essential-qa.cjs, discovery-applied-*.png in thread visualization directory. Both existing test frontends updated; backend/tokens untouched. Uncommitted; preserve unrelated hover preview/tools edits.

### Discovery mobile Addons spacing cleanup
User iPhone screenshot showed duplicate Installed Addons/count and the 32px drag handle occupying a 24px column, crowded name/version, truncated description and inset actions. Narrow-only CSS now hides the repeated heading/count, keeps the profile-scope description compact, reserves a 44px drag target plus 12px gap, puts name and wrapping version on separate lines, limits description to two readable lines, and aligns actions across the row (two button columns below 360px). Global title/header/navbar and desktop rows stay unchanged.

During verification, busy addon re-renders were emitting native details toggle events that could set formOpen=true again after a successful add. The addon manager now ignores detached-node and busy-render toggle events; a regression covers detached events and browser testing proves auto-close. Build 8ed556f32768, scoped ESLint/diff checks and 22 focused tests pass. New long-name/long-version geometry checks at 320/390/834/1920px prove no handle/text/action overlap or clipping and no horizontal overflow. Actual mobile addon toggle and drag ordering pass. Both previews updated; no commit. Remain on Content & Discovery acceptance; Layout/Fusion/Integrations redesigns still await later approvals.


### Layout redesign implemented after separate approval
User approved layout-settings-redesign.html and asked to continue. Browser Layout now has five topic tabs on wide Settings panels (>=1024px) and exclusive accordion cards on smaller screens. Existing Navigation option miniatures are retained; Home, Continue Watching, Detail Page and Card Appearance have local illustrative previews, placed beside controls on wide screens and above controls on narrow screens. Cards use existing chosen theme accent. Mobile orientation choices are compact horizontal rows. Previews do not fetch artwork/media or initiate processing.

Existing Layout actions, preference defaults/profile scope, visibility conditions, device-gated navigation choices, nested Home Catalogs & Collections ordering and all TV render paths remain. Collection CRUD stays in Content & Discovery. The shared Back/title/navbar/background and responsive Settings route handling are unchanged. Browser depth controls use native range inputs: input updates preview/output only, change persists one whitelisted field, pointercancel restores saved presentation; redraw is deferred during drag. Native keyboard slider handling and topic arrow/Home/End support included. TV retains numeric dialogs.

Validation: build 8599affdd4a9, scoped ESLint, XML parsing en/id and diff checks pass; full suite 1698/1698. Three new regression tests cover exclusive topic selection/nested state, bounded depth preview values/surface gating and drag-versus-release persistence. Guest Edge browser QA at 390/1024/1920px verifies all five topics, conditional controls, orientation preview, keyboard sliders, actual pointer drag with storage unchanged until release, responsive history and Back; no runtime errors or horizontal overflow. Existing six-width Settings panels/protected shell regression also passes. All original literal Layout focus keys retained. Evidence layout-implementation-qa.cjs/json and layout-*.png in thread visualization directory.

Both existing client/server preview frontends updated to 8599affdd4a9; backend configuration/tokens unchanged. Work remains uncommitted on development; preserve unrelated desktopMediaHoverPreview.js/tools edits. Stop at Layout implementation acceptance. Fusion Style and Integrations redesigns still need separate designs/approval.


### Integrations redesign implemented after separate approval
User requested Integrations next and approved integrations-settings-redesign.html. Browser Integrations now has four service selection cards on wide Settings panels and exclusive service accordion cards below 1024px. Service summaries show saved configuration/enablement, never imply a live connectivity check. Existing global Back/title/navbar/background and outer Settings routing remain. Debrid's experimental notice remains visible on mobile; AnimeSkip controls remain planned/inert; hidden Real-Debrid remains hidden.

Native renderIntegrationDetail rows and action handlers are reused in a browser-only presentation layer, retaining key masking, Device Code dialogs, API-key validation, credential/capability gates, preference scope/defaults and original TV paths. Accounts appear first in Debrid, followed by Library & playback, collapsed Stream preferences and Source formatting. All 23 original preference rules are grouped by attribute; source filtering/sorting semantics are unchanged. TMDB has connection/usage/title information/more details groups; MDBList has connection/rating sources. Native dialogs still perform every edit. Expanded group state is persisted as Settings UI state; mobile can close all services. New integrationSettingsPresentation helper partitions existing rows without dropping future/unknown controls.

Validation: build d3009d56ddea, scoped ESLint/XML/diff checks pass. Full suite 1701/1701 before final ARIA/notice-only refinement, then 19 focused tests and final browser QA pass. Three new tests cover service defaults and lossless/control-unique grouping including all Debrid rules and future controls. Isolated guest Edge UI at 390/1024/1920px verifies exact original control counts, empty-account disabled gates, TMDB toggle/language dialog, synthetic configured-provider selection, all 23 Debrid rules and multi-choice dialog, existing connected-device dialog, source-template save, responsive history, Back and no overflow/runtime errors. Synthetic credentials were used only in isolated contexts with external API requests intercepted; no real account connected or changed. Existing six-width Settings shell/Back/Forward regression passes.

Both existing client/server test frontends updated to d3009d56ddea; backend/runtime modes/tokens untouched. Evidence integrations-implementation-qa.cjs/json, integrations-applied-*.png in thread visualization directory. Work remains uncommitted on development; preserve unrelated hover preview/tools changes. Stop for Integrations implementation acceptance. Fusion Style redesign still needs a separate proposal and approval.


### Fusion Style + Appearance implemented directly at user request
User explicitly requested both sections plus custom color, with no additional design/example approval step. Browser Appearance now groups accent presets/custom color, background/surfaces and font/language in theme-tinted responsive cards. Eight swatches (seven existing presets plus Custom), a native color picker and HEX edit dialog are provided. Invalid HEX does not save. Saved custom color survives preset switching and uses the existing profile-scoped ThemeStore; preset/default/legacy accent normalization and AMOLED behavior remain. Native picker commits on change; settings routing/header/Back/navbar stay unchanged.

New core/theme/accentColor helper accepts only RGB hex (3/6 digits) and selects black/white accent text by luminance contrast. ThemeColors has a CUSTOM palette branch; ThemeManager passes the saved accent through the normal CSS/RGB/player/legacy-theme pipeline. CUSTOM bypasses legacy preset inference even when its RGB matches an old preset. Existing presets retain their palettes, and customAccentColor remembers the last choice. TV rendering remains as before; a shared profile's custom palette can still be applied by ThemeManager there.

Browser Fusion Style now separates card-display controls, local stream-card examples, and existing expandable badge-source management. Wide screens put controls beside a compact preview; narrow screens stack preview above controls. Filename label estimates/not-probed notice, first-badge placement, badge visibility/position, source import limits, activation/edit/delete and source badge previews reuse original stores/handlers. Scoped preview sizing avoids TV-sized sample cards. Source filtering/sorting, hoster processing, playback and backend behavior are unchanged. No new network calls for appearance or preview.

Validation: build 4bcfc6f8ed6e. Full suite 1704/1704; scoped ESLint, XML parse and diff checks pass. Three new accent regressions cover invalid/short/uppercase HEX, contrasting text/custom palette with preserved presets, and CUSTOM/legacy normalization/preset recall. Isolated guest Edge browser at 390/1024/1920px verifies invalid HEX feedback, saved valid custom CSS/RGB and contrast text, preset/custom recall, native color-input change handling, AMOLED surfaces, Fusion label/size/logo toggles, badge placement, import/activate/preview/delete of synthetic pasted badge-source fixtures, no overflow/runtime errors, responsive history and Back. Native OS color-picker UI itself was not automated; its input/change path and HEX alternative were exercised. Existing six-width shell/protected-navigation regression passes. Evidence appearance-fusion-qa.cjs/json and appearance/fusion-applied screenshots in the thread visualization directory.

Both existing client/server frontends updated to 4bcfc6f8ed6e. Runtime modes/backend/tokens preserved. No commit/push; all Settings work remains uncommitted on development, alongside unrelated hover-preview/tools edits that must be preserved.

Playback wording-only follow-up: user requested simpler filename routing copy and External player topic renamed Player. Browser title now 'Use filename to speed up playback' with an estimate/automatic fallback explanation; English/Indonesian localized, actual route behavior unchanged. Build baf6a35d4542, XML/scoped lint/build/diff checks passed; both test frontends updated. Uncommitted.

Fusion preview follow-up: four illustrative labels (Direct, Remux, Transcoding, Unknown) are always represented when labels are enabled; examples do not claim actual device compatibility. Actual lists and Audio & Video filtered preview keep real device classification. Reused badge renderer; labels remain first in the badge row. Added unknown no-media example and updated preview regression. Build dcdbf6145198, six focused tests plus guest browser four-label/placement check passed. User's final routing wording is 'Determine stream processing based on filename' (supersedes earlier speed wording). Both previews updated; uncommitted.

Audio & Video preview aligned with Fusion on user request: same four illustrative label examples. Preview All shows all four, Direct shows one, Direct+Remux shows two. Added presentation-only filter helper/test; real stream classification/filtering is untouched. Seven focused tests and actual guest browser label/filter check pass. Build 51a505981e52, both frontends updated; uncommitted.

User accepted the Settings UI and requested commit. Final pre-commit suite: 1705/1705 pass; diff checks pass. Commit scope includes responsive Settings, managers, Appearance/custom colors, translations and four-label previews. Excludes unrelated desktopMediaHoverPreview.js delay change and tools/preview-iphone.mjs. Latest preview frontend remains 51a505981e52.

Player audit follow-up: user approved offline-context improvements and ready-to-play downloads, placed touch/keyboard/error/pause/loading in upcoming player redesign, and explicitly retained watch-and-forget. Only its Settings Downloads description changed in this turn (localized; behavior/title unchanged). Four offline progress tests plus lint/build pass; build 1c52ca9b7d49 on both previews. Investigations are documented in player-redesign-followup-audit.md in the thread visualization directory: supplied stream has HEVC + two stereo AAC tracks fr/zh; Chrome 156 native metadata succeeds but audioTracks APIs are undefined, causing direct-track list to be empty. Pause overlay bug reproduced: remuxstatus at 2s repeatedly resets 5s overlay timer; it appears once updates stop. Loading Back/delayed-response cleanup verified; metadata caption is triggered by readyState=0 progress rather than actual probe. Redesign, offline pipeline and functional fixes remain pending; no commit this turn.

### Priority 1 player fixes implemented — 2026-11-03

User authorized all priority 1 work: Direct audio selection in Chrome, built-in subtitles on Direct, and pause overlay timer. Work remains on development; no commit/push. Existing hover-preview/tools edits and earlier watch-and-forget copy retained.

Direct audio inventory is loaded on opening the audio/subtitle dialog through the existing configured prober (not on stream lists). Where the browser exposes no audio selector, source audio entries can enter the existing configured copy-remux route. Hoster off/known unsupported output cannot offer a switch. Preserve playback state/position, reject late preparation after source/navigation changes, and keep manual selection ahead of startup language defaults. Persist the selected runtime track identity after the transition, avoiding wrong matches among unknown-language tracks. Failed discovery can retry on reopening after 15 seconds; probing never blocks working Direct video. Native/HLS/DASH and existing remux selectors remain in place.

Known Direct MKV text subtitles initialize on loadedmetadata without waiting for audio probing; opening track dialogs can also confirm the container from metadata. Reuses createEmbeddedSubtitles, its bounded worker, request headers, settings/delay and seek hooks. Native subtitle tracks take precedence to avoid duplicates; addon selection turns off the separate reader. Reader and pending metadata are cleaned up on source replacement/Back. Local blob/offline handling remains deferred. Supports existing simple MKV text formats, not image subtitles/full ASS rendering. Direct subtitle extraction uses browser requests and remains subject to source CORS/range access; it does not remux/upload the video.

Pause scheduling now preserves an active timer/visible overlay on passive status updates. Explicit keyboard interaction still restarts inactivity delay. Ineligible/playing state cancels it.

Validation: full suite 1714/1714 before final independent-subtitle extraction and two extra regression cases; nearest final tests cover those refinements (11 new Direct/pause cases plus existing relay/browser/mobile/fallback tests). ESLint, XML parsing, diff checks and build pass. Final frontend build 458293e8b7f9, both test ports 4175/4176 return HTTP200 with that ID; frontend bundles match, nuvio.env.js hash preserved, backend/token/modes unchanged.

Chrome 156 isolated guest integration: actual subtitle worker reads 13 ASS tracks from user sample, selects Indonesian with 4 timed cues around 60s, switches to English, turns off, retains one text track and Direct video. Playback used a local fixture while the reader fetched actual source ranges; this is not proof of whole-episode playback. Actual dual-audio MP4 fixture transitions from native Chrome (audioTracks undefined) to real client-remux runtime, audio index 1 stays selected after startup, video frames decode. Fixture inventory supplied to the metadata seam; no real user account/stream preference changed. Pause UI appears with remuxstatus every 2s. Server route selection shares existing prepareUnverifiedRemux coverage; physical iPhone/Safari/PWA and live server audio-switch acceptance remain user verification.

Evidence in visualization directory: priority1-subtitles-chrome.json, priority1-audio-chrome.json, pause-overlay-status-audit.json, priority1-tests-final.log. Do not publish audit scripts or signed source URLs. Priority 2 redesign/loading/offline controls and priority 3 ready-to-play downloads remain pending.

Direct audio selection indicator follow-up: user reported no selected entry before the first switch. Native Chrome does not expose which source audio it chose. The source inventory now has a selected, non-switching 'Player default audio' status entry while Direct is active; it does not falsely mark source ordinal 0. Choosing it is a no-op, including preference writes. Native/HLS/DASH/remux lists have no synthetic default; actual selected track is highlighted after switching. Two new regressions pass alongside 15 existing Direct/relay checks; isolated Chrome proves exactly one default selected before switching and actual audio ordinal 1 selected after real client remux. Build/lint pass; build fd2f1fd1b5a3 on both previews, runtime/token preserved. Uncommitted; same priority 1 scope.

### Pause screen presentation refinement — 2026-11-03
User requested metadata text (year/episode/runtime) at description size, each cast name and role at most two lines, no visible Back on the pause screen, larger title logo, and a single scrolling line for long text titles. Browser-only CSS now shares the metadata/description font size with normal metadata weight, enlarges logo bounds, clamps cast name/role independently to two lines, and hides Back only while the pause overlay is visible. Closing pause restores normal Back. Long title spans animate only on measured overflow; short titles remain still; resize recalculates distance/duration. Reduced-motion disables animation and allows horizontal title scrolling. Existing fit-to-height and native Back handling retained; TV styles unchanged.

Build c4ee3c84dd23, scoped ESLint/build/diff checks and 74 player regression tests pass. Isolated Chrome guest QA at 1440x900,1024x768,844x390,390x844 confirms equal metadata/description size, both cast fields <=2 lines, single-line overflow animation, short-title static, hidden/restored Back, larger logo and no horizontal page overflow. Screenshots visually inspected. Evidence pause-layout-qa.json/png in visualization directory. Both test frontends updated with runtime/env/token preserved; no commit/push. Unrelated hover-preview/tools edits retained.

Pause logo visual QA follow-up: user requested image-logo inspection rather than text heading. Eight Chrome cases cover actual local PNG wordmark (1085x344) and square mark (1080x1080) at desktop/tablet/phone landscape/portrait. Found fixed image-box height plus flex stretch left unnecessary space around wide logos, especially portrait. Browser pause logo now uses automatic intrinsic proportions, maximum size bounds and align-self:flex-start, retaining the enlarged limits. All eight checks prove image box matches displayed image ratio, metadata starts after logo, cast remains within screen, no text title/Back shown. Portrait wordmark box reduces from 253x135 to 253x80 without reducing the visible image. Screenshots inspected; fixtures are local brand images, not actual user movie artwork. Build 6650bd5700f7 passes and both previews updated; runtime/token unchanged. CSS-only refinement, uncommitted. Evidence pause-logo-qa.json and pause-logo-*.png in visualization directory.

Pause vertical centering follow-up: user approved correcting the downward bias. Browser pause overlay drops the obsolete 84px upper control reserve for 16px minimum safe-area padding. fitPauseOverlay uses the larger top/bottom safe-area inset symmetrically for available height and scale, keeping content center on viewport center even when tall content shrinks. Left alignment unchanged. Updated regression verifies the centered tall-content position/scale and the short-content center. 61 browser/mobile player tests, ESLint/build/diff checks pass. Eight image-logo shape/viewport cases verify content center within 1px, containment and no logo/clock intersection; text-title four-width geometry/visual checks also pass. Build a4d197207e0d on both previews with runtime/token unchanged; no commit/push. Evidence pause-logo-qa.json, pause-center-logo.log, pause-center-text.log and screenshots in visualization directory.

Pause orientation/description follow-up: user prefers the larger-logo portrait-device/landscape-player screenshot as the baseline for both physical orientations, with slightly more top/bottom space, and description at most two lines. Browser pause sizing now derives from the existing logical player-canvas dimensions (fallback to viewport for non-touch desktop) rather than physical vw/dvh: logo and gaps use the canvas long edge; type/cast/widths use canvas width. Symmetric pause padding increases to minimum24px, up to48px based on canvas height, respecting safe areas. Description uses two-line clamp/overflow truncation. Existing JS fit/marquee/Back behavior unchanged.

Build 21627d6aa5c4 and diff checks pass. Actual mobile/coarse-pointer Chrome contexts compare player-landscape on physical390x844 (rotated) and844x390 (unrotated), for wide and square PNGs and a long description: logical stage844x390, rendered logo/whole-content height equal within1px, center error0.21px, 24px top/bottom padding, description <=2 lines, font sizes match. Screenshot inspected. Orientation/mobile player regression tests pass; evidence pause-orientation-qa.json/png and pause-orientation-tests.log. Both preview frontends updated with runtime/token preserved; uncommitted.

## Approved unified loading redesign implemented — 2026-11-03

User approved a single loading presentation from source search through first playback, initial loading matching the intended player orientation (mobile defaults landscape), portrait textless poster vs landscape backdrop like Detail, chevron-only Back without rounded background, simplified phases and light indicators for post-start seek/audio changes. Implemented on development; no commit/push. Unrelated hover-preview/tools edits retained.

StartupLoadingOverlay retains one node across Detail/Stream/Player handoff. Finding remains Finding a stream; checking/opening/loading/metadata share Preparing video; first-frame phase becomes Starting playback; restore retains Resuming playback. No inferred percentage is shown. Known relay messages live in a separate detail line, cleared for start/resume, respecting showPlayerLoadingStatus. Back is a transparent/borderless 48x48 target containing only an accessible chevron, available throughout processing. The legacy handoff/internal startup exit uses the same chevron treatment.

Reuses createPlayerOrientation with manageBody=false for the loading canvas: rotation/safe-area/resize logic is shared, but loading never owns/clears the active player body's rotation or scroll handlers. The loading orientation is handed into player navigation, including episode paths. Added setPreference on the existing helper; normal player defaults unchanged. Portrait artwork uses the existing Detail textless-poster resolver/cache and TMDB artwork gate, falling back to regular poster then backdrop; landscape uses backdrop then available poster. Metadata propagates poster/textless poster through Detail, Stream, player source/episode handoffs. No new artwork fetch service, settings or dependency.

Actual internal Player startup can use unified loading even when the saved default external player is Lenna (including explicit internal downloads). External launches/frame playback retain their separate paths. Same-player preserve-position transitions such as audio/source switches suppress the full splash and use the existing buffering indicator; startup readiness/restoration remains unchanged. Passive player events cannot dismiss the next-episode source-search overlay; existing next-episode countdown remains intact. Router installs an exit immediately on player handoff, replaced by the player-specific Back handler when mounted.

Validation: all 1724 tests pass; scoped ESLint/XML/diff checks and build pass. Final build e17d329bbe44 published to both existing frontend previews (4175/4176 HTTP200/build ID verified), nuvio.env.js hash preserved, backend modes/tokens unchanged. Isolated guest Chrome checks desktop1440x900, mobile portrait-device/landscape-canvas844x390, mobile landscape844x390, and portrait390x844: image selection, stable overlay node, real stages/detail, 48px transparent chevron, cleanup and no global body-style changes. Mobile delayed-source actual Router/Player test with saved external default Lenna confirms unified=true/internal hidden, Back returns stream, and delayed source completion does not resurrect playback/overlay. Actual dual-audio fixture transitions into client-remux audio1 with lightweight=true/startup=false/unified=false and frames decoded. Image screenshots visually inspected; test artwork and accounts are isolated local fixtures. Physical iPhone/Safari/PWA acceptance remains user review.

Evidence in visualization directory: loading-redesign-qa.json/png, loading-actual-handoff.json, loading-audio-transition.json, loading-full-tests.log, loading-final-focused.log. Initial missing-storage test fixture emitted oversized data-URL stacks; its temporary log was discarded and fixture storage corrected before successful final tests. Do not publish audit scripts/signed source URLs. Remaining player redesign/offline/download work remains pending.

Loading Back exact-match follow-up: user requires the same Back as the in-player button. Unified, internal and legacy loading exits now use the existing assets/icons/ic_player_back.svg (24px), 44px hit target, and shared desktop/mobile position rules with in-player Back. Transparent/borderless shape retained; no literal glyph or label text drawn. Scoped lint/build/diff checks and 21 relevant tests pass. Actual Router/delayed-video Chrome tests compare both buttons simultaneously: desktop loading/player x48.953,y24,44x44 and mobile rotated x329,y12,44x44; same SVG/24px icon. Both exits work, and delayed response does not restart playback after Back. Build d28c0d77ab13 on both previews; runtime/token retained. Uncommitted. Evidence loading-back-match-mobile.json and loading-back-match-desktop.json.
