#!/usr/bin/env node
/**
 * preview-iphone.mjs — lihat NuvioWeb sebagai iPhone, langsung di Windows.
 *
 * Beda dari sekadar "resize window": skrip ini meng-emulasi perangkat lewat
 * Chrome DevTools Protocol, jadi yang ikut berubah persis seperti di iPhone:
 *
 *   - viewport 393 x 852 dengan deviceScaleFactor 3 (retina)
 *   - `screen.width/height` = ukuran device (bukan ukuran monitor)
 *   - touch emulation aktif -> `(any-pointer: coarse)` dan `(hover: hover)` benar
 *   - user agent iPhone Safari
 *   - auto-reload tiap file berubah (simpan -> layar ikut update)
 *
 * Yang TIDAK bisa dipalsukan di Chromium (butuh iPhone asli):
 *   - env(safe-area-inset-*) tetap 0px
 *   - display-mode: standalone (PWA ter-install)
 *   - keyboard iOS, momentum scroll, dynamic viewport saat address bar menyusut
 *
 * Pakai:
 *   node tools/preview-iphone.mjs                       # http://127.0.0.1:4174/
 *   node tools/preview-iphone.mjs http://127.0.0.1:4174/#/settings
 *   node tools/preview-iphone.mjs --device 11promax     # iPhone 11 Pro Max (414x896)
 *   node tools/preview-iphone.mjs --device se           # iPhone SE
 *   node tools/preview-iphone.mjs --shot out.png        # simpan screenshot lalu keluar
 *   node tools/preview-iphone.mjs --no-notch            # tanpa overlay notch/status bar
 *   node tools/preview-iphone.mjs --no-safe-area        # jangan suntik nilai safe area
 *   node tools/preview-iphone.mjs --show-bounds         # tampilkan band batas safe area
 *   node tools/preview-iphone.mjs --headless --shot a.png
 *   node tools/preview-iphone.mjs --device 11promax --landscape   # orientasi mendatar
 *   node tools/preview-iphone.mjs --devices 16pro,11promax,ipad11   # banyak device sekaligus
 *   node tools/preview-iphone.mjs --devices 16pro,ipad11 --screen 1920x1080
 *   node tools/preview-iphone.mjs --devices 16pro,ipad11 --shot grid.png   # batch PNG
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, watch, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(HERE, "..");

const iphoneUa = (os) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${os.split("_").join(".")} Mobile/15E148 Safari/604.1`;
const ipadUa = (os) =>
  `Mozilla/5.0 (iPad; CPU OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${os.split("_").join(".")} Mobile/15E148 Safari/604.1`;

// `scale` hanya memengaruhi besar jendela (biar iPad muat di layar), layout tetap
// selebar `width`. Dipaksa 1 saat --shot supaya PNG-nya ukuran asli.
const DEVICES = {
  // --- iPhone: Dynamic Island ---
  "16promax": {
    label: "iPhone 16 Pro Max",
    width: 440,
    height: 956,
    dpr: 3,
    ppi: 460,
    safeTop: 62,
    safeBottom: 34,
    notch: "island",
    model: "iPhone",
    scale: 1,
    ua: iphoneUa("18_5")
  },
  "16pro": {
    label: "iPhone 16 Pro",
    width: 402,
    height: 874,
    dpr: 3,
    ppi: 460,
    safeTop: 62,
    safeBottom: 34,
    notch: "island",
    model: "iPhone",
    scale: 1,
    ua: iphoneUa("18_5")
  },
  "15promax": {
    label: "iPhone 15 Pro Max",
    width: 430,
    height: 932,
    dpr: 3,
    ppi: 460,
    safeTop: 59,
    safeBottom: 34,
    notch: "island",
    model: "iPhone",
    scale: 1,
    ua: iphoneUa("17_5")
  },
  "14pro": {
    label: "iPhone 14 Pro",
    width: 393,
    height: 852,
    dpr: 3,
    ppi: 460,
    safeTop: 59,
    safeBottom: 34,
    notch: "island",
    model: "iPhone",
    scale: 1,
    ua: iphoneUa("17_5")
  },
  // --- iPhone: notch klasik ---
  "11promax": {
    label: "iPhone 11 Pro Max",
    width: 414,
    height: 896,
    dpr: 3,
    ppi: 458,
    safeTop: 44,
    safeBottom: 34,
    notch: "wide",
    model: "iPhone",
    scale: 1,
    ua: iphoneUa("17_5")
  },
  13: {
    label: "iPhone 13",
    width: 390,
    height: 844,
    dpr: 3,
    ppi: 460,
    safeTop: 47,
    safeBottom: 34,
    notch: "wide",
    model: "iPhone",
    scale: 1,
    ua: iphoneUa("16_6")
  },
  se: {
    label: "iPhone SE (3rd)",
    width: 375,
    height: 667,
    dpr: 2,
    ppi: 326,
    safeTop: 20,
    safeBottom: 0,
    notch: "none",
    model: "iPhone",
    scale: 1,
    ua: iphoneUa("16_6")
  },
  // --- iPad: tanpa notch, status bar 24, home indicator 20 ---
  ipadmini: {
    label: "iPad mini (6th)",
    width: 744,
    height: 1133,
    dpr: 2,
    ppi: 326,
    safeTop: 24,
    safeBottom: 20,
    notch: "none",
    model: "iPad",
    scale: 0.7,
    ua: ipadUa("18_5")
  },
  ipad11: {
    label: 'iPad Pro 11"',
    width: 834,
    height: 1194,
    dpr: 2,
    ppi: 264,
    safeTop: 24,
    safeBottom: 20,
    notch: "none",
    model: "iPad",
    scale: 0.62,
    ua: ipadUa("18_5")
  },
  ipad13: {
    label: 'iPad Pro 13"',
    width: 1024,
    height: 1366,
    dpr: 2,
    ppi: 264,
    safeTop: 24,
    safeBottom: 20,
    notch: "none",
    model: "iPad",
    scale: 0.55,
    ua: ipadUa("18_5")
  }
};

// ---------- argumen ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const url = argv.find((a) => /^https?:\/\//i.test(a)) || "http://127.0.0.1:4174/";
const deviceKey = (opt("device", "14pro") || "14pro").toLowerCase();
let device = DEVICES[deviceKey] || DEVICES["14pro"];
const headless = flag("headless");
const shotPath = opt("shot");
const noNotch = flag("no-notch");
const noSafeArea = flag("no-safe-area");
const showBounds = flag("show-bounds");
// opsional: klik satu elemen setelah load (untuk masuk ke layar lain di SPA)
const clickSelector = opt("click");
// opsional: jalankan JS apa pun di halaman sebelum screenshot
const evalExpr = opt("eval");
const watchMode = !shotPath && !flag("no-watch");
// orientasi: --landscape (atau --orient landscape)
let landscape = flag("landscape") || String(opt("orient", "")).toLowerCase() === "landscape";

// Insets saat landscape menurut iOS: layar ber-notch/Island tidak punya inset
// atas lagi, tapi kiri/kanan mengambil nilai inset atas portrait dan bawah
// menyusut ke 21. iPad tetap 24/20, SE semuanya 0.
function insetsFor(dev, isLandscape) {
  if (!isLandscape) return { top: dev.safeTop, bottom: dev.safeBottom, left: 0, right: 0 };
  if (dev.notch === "none") {
    return dev.safeBottom > 0
      ? { top: 24, bottom: 20, left: 0, right: 0 }
      : { top: 0, bottom: 0, left: 0, right: 0 };
  }
  return { top: 0, bottom: 21, left: dev.safeTop, right: dev.safeTop };
}

let insets = insetsFor(device, landscape);
let viewW = landscape ? device.height : device.width;
let viewH = landscape ? device.width : device.height;
let orientation = landscape ? "landscape" : "portrait";

// Skala jendela dihitung agar device SELALU muat di layar: iPad 1133px dan
// iPhone 956px tidak akan terpotong, dan saat pindah device lewat Alt+D
// nilainya dihitung ulang (bukan memakai skala device pertama).
const explicitScale = opt("scale");
const screenSpec = (opt("screen", "1920x1080") || "").split("x").map(Number);
let screenW = screenSpec[0] || 1920;
let screenH = screenSpec[1] || 1080;

// --- ukuran fisik (opsional) ---
// CSS px bukan milimeter: monitor ~92 ppi, iPhone ~460 ppi. Jadi pada skala
// 100% sebuah iPhone tampak ~1,6x lebih besar dari aslinya. Dengan --physical,
// skala dihitung dari PPI monitor (dibaca dari EDID) supaya 1:1 dengan device.
function detectMonitorPpi() {
  const stamp = Date.now();
  const ps1 = join(tmpdir(), `preview-monitor-${stamp}.ps1`);
  const outFile = join(tmpdir(), `preview-monitor-${stamp}.txt`);
  try {
    // Hasil ditulis ke file (bukan stdout) supaya tidak bergantung pada pipe
    // antar-proses — sebagian lingkungan (dan sandbox) memblokirnya.
    writeFileSync(
      ps1,
      [
        "$ErrorActionPreference = 'Stop'",
        `$out = '${outFile.replace(/\\/g, "\\\\")}'`,
        "$m = Get-CimInstance -Namespace root\\wmi -ClassName WmiMonitorBasicDisplayParams | Select-Object -First 1",
        "$v = Get-CimInstance Win32_VideoController | Select-Object -First 1",
        "if ($m -and $v) {",
        "  $parts = @($m.MaxHorizontalImageSize, $m.MaxVerticalImageSize, $v.CurrentHorizontalResolution, $v.CurrentVerticalResolution)",
        "  ($parts -join '|') | Set-Content -Path $out -Encoding ASCII",
        "}"
      ].join("\r\n"),
      "utf8"
    );

    spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1], {
      stdio: "ignore",
      timeout: 20000
    });

    const raw = existsSync(outFile) ? readFileSync(outFile, "utf8").trim() : "";
    const [hcm, vcm, wpx, hpx] = raw.split("|").map(Number);
    if (!hcm || !vcm || !wpx || !hpx) return null;
    const diagInch = Math.hypot(hcm, vcm) / 2.54;
    return Math.round(Math.hypot(wpx, hpx) / diagInch);
  } catch {
    return null;
  } finally {
    try {
      rmSync(ps1, { force: true });
    } catch {
      /* abaikan */
    }
    try {
      rmSync(outFile, { force: true });
    } catch {
      /* abaikan */
    }
  }
}

const dpiOverride = Number(opt("dpi", "0")) || null;
const physicalMode = flag("physical") || Boolean(dpiOverride);
let monitorPpi = physicalMode ? dpiOverride || detectMonitorPpi() : null;

const deviceWidthMm = (dev) => ((dev.width * dev.dpr) / (dev.ppi || 460)) * 25.4;

function scaleFor(dev, isLandscape) {
  if (headless || shotPath) return 1; // screenshot selalu ukuran asli
  if (explicitScale) return Number(explicitScale);
  const w = isLandscape ? dev.height : dev.width;
  const h = isLandscape ? dev.width : dev.height;
  if (physicalMode && monitorPpi) {
    // 1 CSS px di iPhone = dpr/ppi_inci inci. Supaya sama besar di monitor:
    // scale = dpr * ppi_monitor / ppi_device
    const s = (dev.dpr * monitorPpi) / (dev.ppi || 460);
    return Math.max(0.2, Math.min(2, Math.round(s * 100) / 100));
  }
  const fit = Math.min(1, (screenW - 130) / w, (screenH - 230) / h);
  return Math.max(0.3, Math.min(1, Math.round(fit * 100) / 100));
}

// zoom = pengali skala jendela (bukan zoom browser/pinch — dua-duanya diblokir
// saat device emulation aktif dan oleh meta viewport `user-scalable=no`)
let zoomFactor = Math.min(3, Math.max(0.25, Number(opt("zoom", "1")) || 1));
let viewScale = Math.min(2, scaleFor(device, landscape) * zoomFactor);

function recompute() {
  insets = insetsFor(device, landscape);
  viewW = landscape ? device.height : device.width;
  viewH = landscape ? device.width : device.height;
  orientation = landscape ? "landscape" : "portrait";
  viewScale = shotPath ? 1 : Math.min(2, scaleFor(device, landscape) * zoomFactor);
}
// 9333 supaya tidak bentrok dengan sesi probe CDP kamu di 9222
// Kalau port ini sudah dipakai (mis. preview lain / sesi probe), ambil port
// berikutnya yang kosong. Tanpa ini, proses baru bisa "membajak" Chrome yang
// sudah jalan dan menimpa emulasinya.
async function pickFreePort(start) {
  for (let p = start; p < start + 25; p++) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/json/version`, {
        signal: AbortSignal.timeout(400)
      });
      if (r.ok) continue; // ada yang mendengarkan -> coba port lain
    } catch {
      return p; // tidak ada yang mendengarkan -> pakai ini
    }
  }
  return start;
}

const requestedPort = Number(opt("port", "9333"));
const cdpPort = await pickFreePort(requestedPort);
if (cdpPort !== requestedPort && !flag("child")) {
  console.log(`   (port ${requestedPort} sedang dipakai proses lain → memakai ${cdpPort})`);
}
// (skala jendela dihitung di scaleFor() di atas)

// --list: tampilkan pilihan device lalu keluar
if (flag("list")) {
  console.log("\nDevice yang tersedia:\n");
  for (const [key, d] of Object.entries(DEVICES)) {
    const mark = d === device ? "→" : " ";
    console.log(
      `  ${mark} ${key.padEnd(10)} ${d.label.padEnd(20)} ${String(d.width + "x" + d.height).padEnd(10)} @${d.dpr}x   safe ${d.safeTop}/${d.safeBottom}   ${d.notch}`
    );
  }
  console.log("\nPakai: node tools/preview-iphone.mjs --device <nama>\n");
  process.exit(0);
}

// ---------- mode banyak device ----------
// Satu proses Node per device (masing-masing punya Chrome + port CDP sendiri),
// jendelanya lalu disusun berdampingan. Dengan --shot jadi batch screenshot.
const deviceList = (opt("devices") || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const isChild = flag("child");

if (deviceList.length > 1 && !isChild) {
  const unknown = deviceList.filter((k) => !DEVICES[k]);
  if (unknown.length) {
    console.error(`\nDevice tidak dikenal: ${unknown.join(", ")}`);
    console.error("Lihat daftarnya: node tools/preview-iphone.mjs --list\n");
    process.exit(1);
  }

  const screenW = Number((opt("screen", "1920x1080") || "").split("x")[0]) || 1920;
  const GAP = 10;
  let x = GAP,
    y = GAP,
    rowHeight = 0;
  const slots = [];
  for (const key of deviceList) {
    const d = DEVICES[key];
    const s = scaleFor(d, landscape);
    const w = Math.round((landscape ? d.height : d.width) * s) + 90;
    const h = Math.round((landscape ? d.width : d.height) * s) + 170;
    if (x + w > screenW - GAP && x > GAP) {
      x = GAP;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    slots.push({ key, x, y });
    x += w + GAP;
    rowHeight = Math.max(rowHeight, h);
  }

  const passthrough = [];
  if (noNotch) passthrough.push("--no-notch");
  if (noSafeArea) passthrough.push("--no-safe-area");
  if (showBounds) passthrough.push("--show-bounds");
  if (clickSelector) passthrough.push("--click", clickSelector);
  if (landscape) passthrough.push("--landscape");
  passthrough.push("--screen", `${screenW}x${screenH}`);

  console.log(`\n🖥  ${slots.length} device sekaligus: ${slots.map((s) => s.key).join(" · ")}`);

  if (shotPath) {
    const base = shotPath.replace(/\.png$/i, "");
    for (const slot of slots) {
      const out = `${base}-${slot.key}.png`;
      const r = spawnSync(
        process.execPath,
        [
          fileURLToPath(import.meta.url),
          "--device",
          slot.key,
          "--headless",
          "--shot",
          out,
          ...passthrough,
          url
        ],
        { stdio: "inherit" }
      );
      if (r.status !== 0) console.warn(`   ${slot.key}: gagal`);
    }
    process.exit(0);
  }

  const children = slots.map((slot, i) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        "--child",
        "--device",
        slot.key,
        "--port",
        String(cdpPort + i + 1),
        "--window-position",
        `${slot.x},${slot.y}`,
        ...passthrough,
        url
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const tag = slot.key.padEnd(10);
    const pipe = (stream, isErr) => {
      let buf = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buf += chunk;
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (line.trim()) (isErr ? process.stderr : process.stdout).write(`[${tag}] ${line}\n`);
        }
      });
    };
    pipe(child.stdout, false);
    pipe(child.stderr, true);
    child.on("exit", () => process.stdout.write(`[${tag}] jendela ditutup\n`));
    return child;
  });

  const stopAll = () => {
    for (const c of children) {
      try {
        c.kill();
      } catch {
        /* sudah mati */
      }
    }
  };
  process.on("SIGINT", () => {
    stopAll();
    process.exit(0);
  });
  process.on("exit", stopAll);

  await new Promise((resolve) => {
    let alive = children.length;
    for (const c of children)
      c.on("exit", () => {
        if (--alive === 0) resolve();
      });
  });
  process.exit(0);
}

// ---------- overlay notch + status bar ----------
// Digambar di dalam halaman (bukan bagian dari Chrome), jadi ikut terlihat di
// jendela maupun di screenshot. Murni kosmetik: layout tetap dari emulasi CDP.
function installOverlay(cfg) {
  const ID = "__ios_preview_overlay__";

  // hotkey/gestur: Alt+scroll = zoom, Alt+klik-tengah = reset, Alt+R putar,
  // Alt+D device berikutnya. Halaman tidak bisa mengubah emulasi sendiri, jadi
  // dikirim ke Node lewat console.
  if (!window.__iosPreviewKeys) {
    window.__iosPreviewKeys = true;

    const emit = (action) => console.log("__IOS_PREVIEW__:" + action);

    window.addEventListener(
      "keydown",
      (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        const k = String(e.key).toLowerCase();
        if (k === "r") {
          e.preventDefault();
          emit("rotate");
        } else if (k === "d") {
          e.preventDefault();
          emit("next-device");
        } else if (k === "=" || k === "+") {
          e.preventDefault();
          emit("zoom-in");
        } else if (k === "-" || k === "_") {
          e.preventDefault();
          emit("zoom-out");
        } else if (k === "0") {
          e.preventDefault();
          emit("zoom-reset");
        }
      },
      true
    );

    // Alt + scroll: satu langkah per ~140 ms supaya tidak membanjiri CDP
    window.addEventListener(
      "wheel",
      (e) => {
        if (!e.altKey) return;
        e.preventDefault();
        const now = Date.now();
        if (now - (window.__iosLastWheel || 0) < 140) return;
        window.__iosLastWheel = now;
        emit(e.deltaY < 0 ? "zoom-in" : "zoom-out");
      },
      { passive: false, capture: true }
    );

    // Alt + klik tengah (mouse wheel ditekan) = reset zoom
    window.addEventListener(
      "mousedown",
      (e) => {
        if (!e.altKey || e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        emit("zoom-reset");
      },
      true
    );
    window.addEventListener(
      "auxclick",
      (e) => {
        if (e.altKey && e.button === 1) e.preventDefault();
      },
      true
    );
  }

  const mount = () => {
    if (!document.body) return;
    const old = document.getElementById(ID);
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = ID;
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;" +
      "font-family:-apple-system,'SF Pro Text','Segoe UI',Roboto,sans-serif";

    const bar = document.createElement("div");
    bar.style.cssText =
      "position:absolute;top:0;left:0;right:0;height:" +
      cfg.insets.top +
      "px;" +
      "display:flex;align-items:center;justify-content:space-between;padding:0 26px;" +
      "color:#fff;font-size:15px;font-weight:600;letter-spacing:.3px;" +
      "text-shadow:0 1px 3px rgba(0,0,0,.5)";

    const clock = document.createElement("span");
    const paint = () => {
      const d = new Date();
      clock.textContent =
        String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    };
    paint();
    setInterval(paint, 20000);

    const icons = document.createElement("span");
    icons.style.cssText = "display:flex;align-items:center;gap:5px";
    icons.innerHTML =
      '<svg width="17" height="11" viewBox="0 0 18 12" fill="currentColor">' +
      '<rect x="1" y="7" width="3" height="4" rx="1"/><rect x="5.5" y="5" width="3" height="6" rx="1"/>' +
      '<rect x="10" y="2.5" width="3" height="8.5" rx="1"/><rect x="14.5" y="0" width="3" height="11" rx="1" opacity=".35"/></svg>' +
      '<svg width="16" height="11" viewBox="0 0 16 12" fill="currentColor">' +
      '<path d="M8 10.6 5.1 7.4a4.4 4.4 0 0 1 5.8 0L8 10.6ZM3 5.3l1.3 1.4a5.9 5.9 0 0 1 7.4 0L13 5.3a7.9 7.9 0 0 0-10 0ZM.7 2.7l1.3 1.4a10.5 10.5 0 0 1 12 0l1.3-1.4a12.5 12.5 0 0 0-14.6 0Z"/></svg>' +
      '<svg width="25" height="12" viewBox="0 0 25 12">' +
      '<rect x="1" y="1" width="20" height="10" rx="3" fill="none" stroke="currentColor" stroke-opacity=".55"/>' +
      '<rect x="2.5" y="2.5" width="14" height="7" rx="1.6" fill="currentColor"/></svg>';

    if (cfg.insets.top > 0) {
      bar.appendChild(clock);
      bar.appendChild(icons);
      wrap.appendChild(bar);
    }

    // notch / Dynamic Island: di landscape tempatnya di sisi kiri, bukan atas
    const landscape = cfg.orientation === "landscape";
    if (cfg.notch === "island") {
      const n = document.createElement("div");
      n.style.cssText = landscape
        ? "position:absolute;top:50%;transform:translateY(-50%);left:0;" +
          "width:36px;height:124px;border-radius:0 18px 18px 0;background:#000"
        : "position:absolute;top:11px;left:50%;transform:translateX(-50%);" +
          "width:124px;height:36px;border-radius:18px;background:#000";
      wrap.appendChild(n);
    } else if (cfg.notch === "wide") {
      const n = document.createElement("div");
      n.style.cssText = landscape
        ? "position:absolute;top:50%;transform:translateY(-50%);left:0;" +
          "width:31px;height:200px;border-radius:0 15px 15px 0;background:#000"
        : "position:absolute;top:0;left:50%;transform:translateX(-50%);" +
          "width:200px;height:31px;border-radius:0 0 15px 15px;background:#000";
      wrap.appendChild(n);
    }

    if (cfg.insets.bottom > 0) {
      const h = document.createElement("div");
      h.style.cssText =
        "position:absolute;bottom:8px;left:50%;transform:translateX(-50%);" +
        "width:134px;height:5px;border-radius:3px;background:rgba(255,255,255,.5)";
      wrap.appendChild(h);
    }

    // --- safe area: env() tidak bisa ditimpa, jadi yang disuntik adalah
    //     custom property yang dipakai layout NuvioWeb ---
    if (cfg.safeArea) {
      const st = document.createElement("style");
      st.id = "__ios_safe_area_style__";
      st.textContent =
        ":root{" +
        "--safe-area-inset-top:" +
        cfg.insets.top +
        "px;" +
        "--safe-area-inset-right:" +
        cfg.insets.right +
        "px;" +
        "--safe-area-inset-bottom:" +
        cfg.insets.bottom +
        "px;" +
        "--safe-area-inset-left:" +
        cfg.insets.left +
        "px;" +
        "}" +
        ".desktop-browser,html.desktop-browser,body.desktop-browser{" +
        "--browser-safe-area-top:" +
        cfg.insets.top +
        "px !important;" +
        "--browser-safe-area-right:" +
        cfg.insets.right +
        "px !important;" +
        "--browser-safe-area-bottom:" +
        cfg.insets.bottom +
        "px !important;" +
        "--browser-safe-area-left:" +
        cfg.insets.left +
        "px !important;" +
        "}";
      (document.head || document.documentElement).appendChild(st);
    }

    if (cfg.showBounds) {
      const band = (css, label, align) => {
        const d = document.createElement("div");
        d.style.cssText = "position:absolute;background:rgba(255,45,85,.22);" + css;
        const tag = document.createElement("span");
        tag.textContent = label;
        tag.style.cssText =
          "position:absolute;font-size:10px;font-weight:700;" +
          "color:#ff2d55;text-shadow:0 1px 2px rgba(0,0,0,.7);" +
          align;
        d.appendChild(tag);
        wrap.appendChild(d);
      };
      if (cfg.insets.top > 0)
        band(
          "top:0;left:0;right:0;height:" + cfg.insets.top + "px",
          cfg.insets.top + "px atas",
          "right:8px;bottom:1px"
        );
      if (cfg.insets.bottom > 0)
        band(
          "bottom:0;left:0;right:0;height:" + cfg.insets.bottom + "px",
          cfg.insets.bottom + "px bawah",
          "left:50%;transform:translateX(-50%);top:1px"
        );
      if (cfg.insets.left > 0)
        band(
          "top:0;bottom:0;left:0;width:" + cfg.insets.left + "px",
          cfg.insets.left + "px kiri",
          "bottom:8px;left:4px;writing-mode:vertical-rl"
        );
      if (cfg.insets.right > 0)
        band(
          "top:0;bottom:0;right:0;width:" + cfg.insets.right + "px",
          cfg.insets.right + "px kanan",
          "bottom:8px;right:4px;writing-mode:vertical-rl"
        );
    }

    // --- panel kontrol: device · orientasi · zoom (hanya di jendela) ---
    if (cfg.panel) {
      const panel = document.createElement("div");
      panel.id = "__ios_preview_panel__";
      panel.style.cssText =
        "position:absolute;left:8px;bottom:" +
        (cfg.insets.bottom + 10) +
        "px;z-index:2147483647;" +
        "pointer-events:auto;display:flex;align-items:center;gap:5px;padding:5px 7px;" +
        "border-radius:10px;white-space:nowrap;backdrop-filter:blur(8px);" +
        "background:rgba(8,12,18,.86);border:1px solid rgba(120,170,255,.42);" +
        "box-shadow:0 4px 16px rgba(0,0,0,.5);" +
        "font:600 11px/1.25 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cfe3ff";

      const sel = document.createElement("select");
      sel.title = "ganti device (Alt+D)";
      sel.style.cssText =
        "background:#0e1420;color:#cfe3ff;border:1px solid rgba(120,170,255,.38);" +
        "border-radius:6px;padding:2px 3px;font:inherit;max-width:132px;cursor:pointer";
      for (const [key, label] of cfg.devices) {
        const o = document.createElement("option");
        o.value = key;
        o.textContent = label;
        o.selected = key === cfg.selectedDevice;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => console.log("__IOS_PREVIEW__:device:" + sel.value));

      const mkBtn = (text, action, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.title = title;
        b.style.cssText =
          "background:#13203a;color:#cfe3ff;border:1px solid rgba(120,170,255,.38);" +
          "border-radius:6px;padding:2px 6px;font:inherit;cursor:pointer;line-height:1.3";
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log("__IOS_PREVIEW__:" + action);
        });
        return b;
      };

      const zoomLabel = document.createElement("span");
      zoomLabel.textContent = cfg.zoom.toFixed(2) + "×";
      zoomLabel.title = "klik untuk reset ke 1.00×";
      zoomLabel.style.cssText = "min-width:34px;text-align:center;cursor:pointer;opacity:.95";
      zoomLabel.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("__IOS_PREVIEW__:zoom-reset");
      });

      panel.append(
        sel,
        mkBtn(cfg.orientation === "landscape" ? "⤡" : "⤢", "rotate", "putar orientasi (Alt+R)"),
        mkBtn("−", "zoom-out", "perkecil (Alt+scroll turun)"),
        zoomLabel,
        mkBtn("+", "zoom-in", "perbesar (Alt+scroll naik)")
      );

      wrap.appendChild(panel);
    }

    // judul jendela/taskbar: device + orientasi + zoom (selalu, bukan hanya
    // saat panel in-page aktif)
    if (cfg.hud) {
      window.__iosTitleWant = cfg.hud;
      const applyTitle = () => {
        if (window.__iosTitleWant && document.title !== window.__iosTitleWant) {
          document.title = window.__iosTitleWant;
        }
      };
      applyTitle();
      if (!window.__iosTitleObserver) {
        window.__iosTitleObserver = new MutationObserver(applyTitle);
        const watchTitle = () => {
          const t = document.querySelector("title");
          if (t)
            window.__iosTitleObserver.observe(t, {
              childList: true,
              characterData: true,
              subtree: true
            });
          applyTitle();
        };
        if (document.querySelector("title")) watchTitle();
        else document.addEventListener("DOMContentLoaded", watchTitle, { once: true });
      }
    }

    document.body.appendChild(wrap);
  };

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

// ---------- cari Chrome ----------
function findChrome() {
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    process.env.CHROME_PATH
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    console.error("Chrome/Edge tidak ditemukan. Set CHROME_PATH ke chrome.exe.");
    process.exit(1);
  }
  return found;
}

// ---------- CDP minimal ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp(port, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch {
      /* belum siap */
    }
    await sleep(200);
  }
  throw new Error(`CDP di port ${port} tidak siap. Port sudah dipakai Chrome lain?`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const eventListeners = new Set();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of eventListeners) {
        try {
          fn(msg);
        } catch {
          /* jangan sampai merusak loop */
        }
      }
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const send = (method, params = {}, sessionId = null) => {
    const id = nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  return { ws, ready, send, onEvent: (fn) => eventListeners.add(fn) };
}

// ---------- main ----------
const userDataDir = join(tmpdir(), `nuvio-iphone-preview-${Date.now()}`);
mkdirSync(userDataDir, { recursive: true });

const chrome = spawn(
  findChrome(),
  [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    // dialog "password ditemukan di kebocoran data" mengganggu preview
    "--disable-features=PasswordLeakDetection,PasswordStrengthIndicator,AutofillServerCommunication",
    "--disable-save-password-bubble",
    `--window-size=${Math.round(viewW * viewScale) + 90},${Math.round(viewH * viewScale) + 170}`,
    `--window-position=${opt("window-position", "40,40")}`,
    headless ? "--headless=new" : "--new-window",
    "about:blank"
  ],
  { stdio: "ignore", detached: false }
);

const cleanup = () => {
  try {
    chrome.kill();
  } catch {
    /* sudah mati */
  }
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    /* terkunci */
  }
  try {
    if (typeof controlServer !== "undefined" && controlServer) controlServer.close();
  } catch {
    /* abaikan */
  }
  try {
    if (typeof controlProc !== "undefined" && controlProc) controlProc.kill();
  } catch {
    /* abaikan */
  }
  try {
    if (controlDataDir) rmSync(controlDataDir, { recursive: true, force: true });
  } catch {
    /* terkunci */
  }
};
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

const version = await waitForCdp(cdpPort);
const { ws, ready, send, onEvent } = connect(version.webSocketDebuggerUrl);
await ready;

const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === "page") || targets[0];
const { sessionId } = await send("Target.attachToTarget", { targetId: page.id, flatten: true });

await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);

// Ukur area kerja layar yang sebenarnya (bukan asumsi 1920x1080), supaya
// skala jendela pas: iPad 1133px tidak terpotong di layar 1080p.
async function detectWorkArea() {
  if (headless || shotPath || explicitScale) return;
  try {
    const { windowId } = await send("Browser.getWindowForTarget", { targetId: page.id });
    await send("Browser.setWindowBounds", { windowId, bounds: { windowState: "maximized" } });
    await sleep(350);
    const max = await send("Browser.getWindowBounds", { windowId });
    await send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    if (max?.bounds?.width > 200 && max?.bounds?.height > 200) {
      screenW = max.bounds.width;
      screenH = max.bounds.height;
    }
  } catch {
    /* biarkan pakai --screen / default */
  }
}

async function sizeWindow() {
  try {
    const { windowId } = await send("Browser.getWindowForTarget", { targetId: page.id });
    await send("Browser.setWindowBounds", {
      windowId,
      bounds: {
        width: Math.round(viewW * viewScale) + 90,
        height: Math.round(viewH * viewScale) + 170
      }
    });
  } catch {
    /* versi Chrome lama: abaikan */
  }
}

await detectWorkArea();
recompute();

// === emulasi device (inti dari skrip ini) ===
await send(
  "Emulation.setDeviceMetricsOverride",
  {
    width: viewW,
    height: viewH,
    deviceScaleFactor: device.dpr,
    mobile: true,
    screenWidth: viewW,
    screenHeight: viewH,
    screenOrientation: landscape
      ? { type: "landscapePrimary", angle: 90 }
      : { type: "portraitPrimary", angle: 0 },
    scale: viewScale
  },
  sessionId
);

await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
await send(
  "Emulation.setEmitTouchEventsForMouse",
  { enabled: true, configuration: "mobile" },
  sessionId
);
const osMatch = device.ua.match(/OS (\d+)_(\d+)/);
const osVersion = osMatch ? `${osMatch[1]}.${osMatch[2]}` : "17.5";
await send(
  "Emulation.setUserAgentOverride",
  {
    userAgent: device.ua,
    platform: device.model,
    userAgentMetadata: {
      platform: device.model,
      platformVersion: osVersion,
      architecture: "",
      model: device.model,
      mobile: true,
      brands: [{ brand: "Safari", version: osMatch ? osMatch[1] : "17" }]
    }
  },
  sessionId
);

// sesuaikan besar jendela dengan skala yang baru dihitung dari area kerja layar
await sizeWindow();

console.log(
  `\n📱 ${device.label} — ${viewW}x${viewH} @${device.dpr}x · ${orientation}` +
    (viewScale !== 1
      ? ` · jendela ${Math.round(viewScale * 100)}% (layout tetap ${viewW}px)`
      : "") +
    ` · layar ${screenW}x${screenH}`
);
console.log(
  `   safe area: atas ${insets.top} · bawah ${insets.bottom} · kiri ${insets.left} · kanan ${insets.right} · ` +
    (noSafeArea ? "tidak disuntik" : "disuntik ke --browser-safe-area-*") +
    (showBounds ? " · band batas aktif" : "")
);
console.log(`   ${url}`);
if (physicalMode) {
  const ppiLabel = monitorPpi ? `${monitorPpi} ppi` : "tidak terdeteksi → pakai --dpi 81";
  console.log(
    `   1:1 fisik: monitor ${ppiLabel} · device ${device.ppi} ppi · ` +
      `skala ${Math.round(viewScale * 100)}% · lebar layar ${Math.round(deviceWidthMm(device))} mm`
  );
} else {
  console.log(
    `   skala ${Math.round(viewScale * 100)}% (bukan ukuran fisik; pakai --physical untuk 1:1)`
  );
}
console.log(
  `   touch: on · UA: ${device.model} Safari · notch: ${noNotch ? "off" : device.notch} · ` +
    (headless ? "headless" : "window Chrome")
);
if (watchMode) console.log(`   auto-reload: menunggu perubahan file di ${APP_ROOT}\n`);

// HUD + judul jendela: supaya selalu jelas sedang pakai device & orientasi apa
const hudText = () =>
  `${device.label} · ${orientation} · ${viewW}×${viewH}` +
  (Math.abs(zoomFactor - 1) > 0.01 ? ` · zoom ${zoomFactor.toFixed(2)}×` : "");

const currentKey = () => Object.keys(DEVICES).find((k) => DEVICES[k] === device);

const overlayCfg = () => ({
  insets,
  orientation,
  notch: device.notch,
  safeArea: !noSafeArea,
  showBounds,
  hud: shotPath ? null : hudText(), // screenshot tetap bersih
  panel: !shotPath && !noNotch && flag("panel-in-page"), // panel kontrol (opsional, di dalam layar)
  devices: Object.entries(DEVICES).map(([k, v]) => [k, v.label]),
  selectedDevice: currentKey(),
  zoom: zoomFactor
});
const overlaySourceFor = () => `(${installOverlay.toString()})(${JSON.stringify(overlayCfg())})`;

// Runtime.evaluate TIDAK reject saat skrip halaman error — exception-nya
// dikembalikan di exceptionDetails. Tanpa ini, overlay bisa gagal diam-diam.
async function injectOverlay() {
  const res = await send("Runtime.evaluate", { expression: overlaySourceFor() }, sessionId).catch(
    (e) => {
      console.warn("   ⚠ overlay gagal dikirim:", e.message);
      return null;
    }
  );
  if (res?.exceptionDetails) {
    const d = res.exceptionDetails;
    console.warn("   ⚠ overlay error:", d.exception?.description?.split("\n")[0] || d.text);
  }
  return res;
}

console.log("   gestur: Alt+scroll zoom · Alt+klik-tengah reset · Alt+R putar · Alt+D device");

// state berubah saat hotkey dipakai, jadi script-nya dipasang ulang
let overlayScriptId = null;
async function installOverlayScript() {
  if (overlayScriptId) {
    await send(
      "Page.removeScriptToEvaluateOnNewDocument",
      { identifier: overlayScriptId },
      sessionId
    ).catch(() => {});
    overlayScriptId = null;
  }
  if (noNotch) return;
  const res = await send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: overlaySourceFor()
    },
    sessionId
  ).catch(() => null);
  overlayScriptId = res?.identifier ?? null;
}

// menerapkan ulang seluruh emulasi untuk state sekarang (dipakai hotkey)
async function applyEmulation() {
  await send(
    "Emulation.setDeviceMetricsOverride",
    {
      width: viewW,
      height: viewH,
      deviceScaleFactor: device.dpr,
      mobile: true,
      screenWidth: viewW,
      screenHeight: viewH,
      screenOrientation: landscape
        ? { type: "landscapePrimary", angle: 90 }
        : { type: "portraitPrimary", angle: 0 },
      scale: viewScale
    },
    sessionId
  );

  // jendela Chrome ikut disesuaikan supaya halaman tidak terpotong setelah putar
  await sizeWindow();

  await installOverlayScript();
  await injectOverlay();
}

async function rotate() {
  landscape = !landscape;
  recompute();
  await applyEmulation();
  console.log(
    `   ⟳ ${orientation} — ${viewW}x${viewH} · safe ${insets.top}/${insets.bottom}/${insets.left}/${insets.right}`
  );
}

async function nextDevice() {
  const keys = Object.keys(DEVICES);
  const currentKey = keys.find((k) => DEVICES[k] === device);
  device = DEVICES[keys[(keys.indexOf(currentKey) + 1) % keys.length]];
  recompute();
  const osMatch = device.ua.match(/OS (\d+)_(\d+)/);
  await send(
    "Emulation.setUserAgentOverride",
    {
      userAgent: device.ua,
      platform: device.model,
      userAgentMetadata: {
        platform: device.model,
        platformVersion: osMatch ? `${osMatch[1]}.${osMatch[2]}` : "17.5",
        architecture: "",
        model: device.model,
        mobile: true,
        brands: [{ brand: "Safari", version: osMatch ? osMatch[1] : "17" }]
      }
    },
    sessionId
  );
  await applyEmulation();
  console.log(
    `   → ${device.label} — ${viewW}x${viewH} · safe ${insets.top}/${insets.bottom}/${insets.left}/${insets.right}`
  );
}

async function setZoom(next) {
  zoomFactor = Math.min(3, Math.max(0.25, Math.round(next * 100) / 100));
  recompute();
  await applyEmulation(); // skala jendela + ukuran device diterapkan ulang
  console.log(
    `   🔍 zoom ${zoomFactor.toFixed(2)}× → jendela ${Math.round(viewScale * 100)}% (layout tetap ${viewW}px)`
  );
}

async function setDeviceByKey(key) {
  const next = DEVICES[key];
  if (!next || next === device) return;
  device = next;
  recompute();
  const m = device.ua.match(/OS (\d+)_(\d+)/);
  await send(
    "Emulation.setUserAgentOverride",
    {
      userAgent: device.ua,
      platform: device.model,
      userAgentMetadata: {
        platform: device.model,
        platformVersion: m ? `${m[1]}.${m[2]}` : "17.5",
        architecture: "",
        model: device.model,
        mobile: true,
        brands: [{ brand: "Safari", version: m ? m[1] : "17" }]
      }
    },
    sessionId
  );
  await applyEmulation();
  console.log(
    `   → ${device.label} — ${viewW}x${viewH} · safe ${insets.top}/${insets.bottom}/${insets.left}/${insets.right}`
  );
}

onEvent((msg) => {
  if (msg.method !== "Runtime.consoleAPICalled") return;
  const marker = msg.params?.args?.[0]?.value;
  if (typeof marker !== "string" || !marker.startsWith("__IOS_PREVIEW__:")) return;
  const action = marker.slice("__IOS_PREVIEW__:".length);
  if (action === "rotate") rotate();
  else if (action === "next-device") nextDevice();
  else if (action === "zoom-in") setZoom(zoomFactor + 0.25);
  else if (action === "zoom-out") setZoom(zoomFactor - 0.25);
  else if (action === "zoom-reset") setZoom(1);
  else if (action.startsWith("device:")) setDeviceByKey(action.slice(7));
});

// dipasang sebelum navigasi supaya ikut muncul lagi setiap auto-reload
await installOverlayScript();

async function navigate(target = url) {
  await send("Page.navigate", { url: target }, sessionId);
  // tunggu sampai dokumen selesai
  for (let i = 0; i < 100; i++) {
    const state = await send(
      "Runtime.evaluate",
      { expression: "document.readyState", returnByValue: true },
      sessionId
    )
      .then((r) => r.result?.value)
      .catch(() => null);
    if (state === "complete") return;
    await sleep(150);
  }
}

async function screenshot(file) {
  const { data } = await send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    sessionId
  );
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`💾 ${file}`);
}

// Tunggu server lokal hidup dulu — kalau tidak, Chrome cuma menampilkan
// halaman kosong dan sulit dibedakan dari bug layout.
async function waitForServer(target, tries = 40) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(target)) return true;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(target, { method: "GET", signal: AbortSignal.timeout(1500) });
      if (r.status < 500) return true;
    } catch {
      /* belum hidup */
    }
    if (i === 0) console.log(`   ⏳ server belum hidup, menunggu ${target} ...`);
    if (i === 1) console.log("      (jalankan dulu: node scripts/serve.mjs)");
    await sleep(1000);
  }
  console.warn("   ⚠ server tidak kunjung hidup — lanjut, halaman mungkin kosong");
  return false;
}

await waitForServer(url);
await navigate();

// ---------- panel kontrol di jendela terpisah (di luar layar device) ----------
async function startControlPanel() {
  // cari port HTTP yang kosong
  let port = 9401;
  for (; port < 9440; port++) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) });
    } catch {
      break;
    }
  }

  const stateJson = () =>
    JSON.stringify({
      device: currentKey(),
      label: device.label,
      devices: Object.entries(DEVICES).map(([k, v]) => [k, v.label]),
      orientation,
      zoom: zoomFactor,
      viewW,
      viewH,
      scale: Math.round(viewScale * 100)
    });

  const page = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<title>Preview Control</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:10px; background:#0b0f16; color:#cfe3ff;
         font:600 12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
  .row { display:flex; gap:6px; align-items:center; margin-bottom:8px; }
  select, button { background:#13203a; color:#cfe3ff; border:1px solid rgba(120,170,255,.38);
                   border-radius:7px; padding:5px 8px; font:inherit; cursor:pointer; }
  select { flex:1; min-width:0; }
  button:hover, select:hover { border-color:#5a8dd8; }
  .z { min-width:52px; text-align:center; }
  .info { color:#7f93ad; font-size:11px; margin-top:6px; display:flex; justify-content:space-between; }
</style></head><body>
<div class="row"><select id="dev"></select></div>
<div class="row">
  <button id="rot" title="putar orientasi">⤢ putar</button>
  <button id="zo" title="perkecil">−</button>
  <span class="z" id="zv">1.00×</span>
  <button id="zi" title="perbesar">+</button>
  <button id="zr" title="reset zoom">⟲</button>
</div>
<div class="row"><button id="rl" title="reload halaman">↻ reload</button></div>
<div class="info"><span id="dims">—</span><span id="orient">—</span></div>
<script>
const $ = (id) => document.getElementById(id);
const cmd = async (action) => {
  try { const r = await fetch('/cmd?action=' + encodeURIComponent(action)); paint(await r.json()); }
  catch { $('dims').textContent = 'koneksi putus'; }
};
const paint = (s) => {
  if (!s) return;
  const sel = $('dev');
  if (sel.options.length !== s.devices.length) {
    sel.innerHTML = '';
    for (const [k, label] of s.devices) { const o = document.createElement('option'); o.value = k; o.textContent = label; sel.appendChild(o); }
  }
  sel.value = s.device;
  $('zv').textContent = s.zoom.toFixed(2) + '×';
  $('dims').textContent = s.viewW + '×' + s.viewH + ' · ' + s.scale + '%';
  $('orient').textContent = s.orientation;
};
$('dev').addEventListener('change', (e) => cmd('device:' + e.target.value));
$('rot').addEventListener('click', () => cmd('rotate'));
$('zi').addEventListener('click', () => cmd('zoom-in'));
$('zo').addEventListener('click', () => cmd('zoom-out'));
$('zr').addEventListener('click', () => cmd('zoom-reset'));
$('rl').addEventListener('click', () => cmd('reload'));
setInterval(async () => { try { paint(await (await fetch('/state')).json()); } catch {} }, 700);
fetch('/state').then(r => r.json()).then(paint);
</script></body></html>`;

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${port}`);
    if (u.pathname === "/state") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(stateJson());
    }
    if (u.pathname === "/cmd") {
      const action = u.searchParams.get("action") || "";
      try {
        if (action === "rotate") await rotate();
        else if (action === "zoom-in") await setZoom(zoomFactor + 0.25);
        else if (action === "zoom-out") await setZoom(zoomFactor - 0.25);
        else if (action === "zoom-reset") await setZoom(1);
        else if (action === "reload") await send("Page.reload", { ignoreCache: true }, sessionId);
        else if (action.startsWith("device:")) await setDeviceByKey(action.slice(7));
      } catch (e) {
        console.warn("   ⚠ panel:", e.message);
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(stateJson());
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(page);
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  // Taruh di samping jendela device. Target.createTarget(newWindow) tidak selalu
  // jadi jendela baru (Chrome bisa menggabungkannya sebagai tab), jadi panel
  // dibuka sebagai proses Chrome sendiri dalam mode --app (tanpa toolbar).
  let left = 620,
    top = 40;
  try {
    const { windowId } = await send("Browser.getWindowForTarget", { targetId: page.id });
    const dev = await send("Browser.getWindowBounds", { windowId });
    left = (dev.bounds?.left || 0) + (dev.bounds?.width || 600) + 12;
    top = dev.bounds?.top || 40;
  } catch {
    /* pakai default */
  }

  controlDataDir = join(tmpdir(), `preview-panel-${Date.now()}`);
  mkdirSync(controlDataDir, { recursive: true });
  controlProc = spawn(
    findChrome(),
    [
      `--app=http://127.0.0.1:${port}/`,
      `--user-data-dir=${controlDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--window-size=520,250",
      `--window-position=${left},${top}`
    ],
    { stdio: "ignore" }
  );

  console.log(`   🕹 panel kontrol: http://127.0.0.1:${port}/`);
  return server;
}

let controlServer = null;
let controlProc = null;
let controlDataDir = "";
if (!headless && !shotPath) {
  controlServer = await startControlPanel();
}

// pasang overlay ke dokumen yang sedang terbuka juga
if (!noNotch) {
  await injectOverlay();
}

// (zoom awal sudah termasuk di viewScale saat start)

// bukti injeksi benar-benar terbaca oleh layout
if (!noSafeArea) {
  const read = await send(
    "Runtime.evaluate",
    {
      expression: `(() => {
      const cs = getComputedStyle(document.documentElement);
      return JSON.stringify({
        top: cs.getPropertyValue("--browser-safe-area-top").trim(),
        bottom: cs.getPropertyValue("--browser-safe-area-bottom").trim(),
        left: cs.getPropertyValue("--browser-safe-area-left").trim(),
        right: cs.getPropertyValue("--browser-safe-area-right").trim(),
      });
    })()`,
      returnByValue: true
    },
    sessionId
  ).catch(() => null);
  if (read?.result?.value) console.log("   terbaca di halaman: " + read.result.value);
}

// cek cepat: apakah halaman benar-benar melihat dunia seukuran device ini
const metrics = await send(
  "Runtime.evaluate",
  {
    expression: `JSON.stringify({
    viewport: innerWidth + "x" + innerHeight,
    dpr: devicePixelRatio,
    screen: screen.width + "x" + screen.height,
    touchPoints: navigator.maxTouchPoints,
    coarse: matchMedia("(any-pointer: coarse)").matches,
    standalone: matchMedia("(display-mode: standalone)").matches
  })`,
    returnByValue: true
  },
  sessionId
).catch(() => null);
if (metrics?.result?.value) console.log("   halaman melihat: " + metrics.result.value);

if (evalExpr) {
  await sleep(1200);
  await send(
    "Runtime.evaluate",
    {
      expression: evalExpr,
      awaitPromise: true,
      userGesture: true
    },
    sessionId
  ).catch((e) => console.warn("   eval gagal: " + e.message));
  await sleep(900);
}

if (clickSelector) {
  await sleep(2500); // SPA butuh waktu render sebelum elemennya ada
  let clicked = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    clicked = await send(
      "Runtime.evaluate",
      {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(clickSelector)}); if (!el) return false; el.click(); return true; })()`,
        returnByValue: true
      },
      sessionId
    ).catch(() => null);
    if (clicked?.result?.value) break;
    await sleep(600);
  }
  console.log(`   klik ${clickSelector}: ${clicked?.result?.value ? "ok" : "tidak ketemu"}`);
  await sleep(1600);
}

if (shotPath) {
  await sleep(3200); // beri waktu render & fetch (SPA NuvioWeb butuh waktu)
  await screenshot(shotPath);
  ws.close();
  cleanup();
  process.exit(0);
}

if (watchMode) {
  // Satu penyimpanan sering menulis beberapa file beruntun. Debounce + jarak
  // minimum antar reload mencegah "badai reload".
  // (^|/) penting: path relatif seperti "dist\css\base.css" tidak punya
  // pemisah di depan, jadi tanpa ini filternya meleset.
  const skip =
    /(^|[\\/])(node_modules|\.git|dist|build|\.cache|screenshots?|\.preview|tools)[\\/]/i;
  const DEBOUNCE_MS = 600;
  const MIN_GAP_MS = 2500;
  let debounce = null;
  let lastReload = 0;
  let lastFile = "";

  const doReload = async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastReload));
    if (wait > 0) {
      // masih terlalu rapat: tunda, jangan menumpuk
      debounce = setTimeout(doReload, wait);
      return;
    }
    lastReload = Date.now();
    try {
      await send("Page.reload", { ignoreCache: true }, sessionId);
    } catch {
      /* navigasi berikutnya akan memperbaiki */
    }
    // nama file dicatat supaya ketahuan apa yang memicu reload
    process.stdout.write(`   ↻ reload ${new Date().toLocaleTimeString()}  ${lastFile}\n`);
  };

  try {
    watch(APP_ROOT, { recursive: true }, (event, file) => {
      if (!file || skip.test(file)) return;
      if (!/\.(js|mjs|css|html|json|svg|png|webp)$/i.test(file)) return;
      if (/(\.log|\.tmp|~)$/i.test(file)) return;
      lastFile = file;
      clearTimeout(debounce);
      debounce = setTimeout(doReload, DEBOUNCE_MS);
    });
  } catch (err) {
    console.warn("   (auto-reload tidak aktif:", err.message + ")");
  }
}

// biarkan proses hidup selama jendela Chrome terbuka
chrome.on("exit", () => process.exit(0));
