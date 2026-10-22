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
