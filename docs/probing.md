# Probe location for hosters

Set `PROBE_MODE` for the deployment. It is independent of each user's label,
Direct-only, HDR, and autoplay preferences.

| Value    | Behaviour                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server` | Existing ffprobe endpoint. Node devserver defaults to `/api/probe`; static/Nginx hosting needs a reachable `PROBE_ENDPOINT`.                                                            |
| `client` | Browser runs single-thread ffprobe WASM and reads the source directly with CORS/HTTP Range. No probe requests go through the Nuvio server.                                              |
| `off`    | Neither server nor client probing. No WASM loading or probe requests. Playback remains available; settings that require confirmed Direct results cannot establish them without probing. |

The default remains `server`. `PROBE_ENABLED=false` is accepted as a legacy off
switch when `PROBE_MODE` is absent. An explicit mode is authoritative. Invalid
modes fail closed to `off`. Environment variables override `local.properties`
on the Node devserver; remove an inherited `PROBE_ENABLED` when configuring only
through `local.properties`. Restart the host and reload open clients after changes.

## Node development server

PowerShell examples (retain the other deployment variables):

```powershell
# Existing server ffprobe
$env:PROBE_MODE='server'
$env:FFPROBE_PATH='C:\path\to\ffprobe.exe'
node scripts/serve.mjs

# Browser-only probing; the server probe endpoint is disabled
$env:PROBE_MODE='client'
node scripts/serve.mjs

# No probing
$env:PROBE_MODE='off'
node scripts/serve.mjs
```

The same `PROBE_MODE=server|client|off` property can be set in
`local.properties` before building. Only the public mode and endpoint are sent
to browsers; ffprobe paths and provider credentials are not included.

## Docker and static hosting

Docker Compose accepts `PROBE_MODE` in `.env`. For `client` or `off`,
`PROBE_ENDPOINT` is cleared from runtime browser configuration. For server
probing, keep the existing endpoint/bridge setup. Generic static hosting can
set `PROBE_MODE` in its public `nuvio.env.js` or build configuration.

`npm run build` copies the pinned `@ffmpeg/core` JavaScript/WASM and bundles the
small probe Worker into `dist/assets/libs/ffprobe/`. Serve the whole `dist`
directory, including this folder. No third-party CDN is required. Serve WASM
with `Content-Type: application/wasm`. Custom CSP must allow same-origin workers,
WebAssembly execution, and connections to the chosen media source.

## Browser-mode requirements and resource limits

- The source must allow CORS and honour single byte ranges with HTTP 206.
  Prefer an exposed `Content-Range` header (for example
  `Access-Control-Expose-Headers: Content-Range`). If hidden, a CORS-readable HEAD
  response must provide the full `Content-Length`, and each HTTP 206 response must
  provide the exact requested partial `Content-Length`. No file size is guessed.
  The browser must be able to follow the complete redirect chain under CORS.
- Requests omit cookies; credentials already contained in a signed source URL
  remain in the URL. URLs are not sent to a probe proxy or logged by this module.
- A server that ignores Range is cancelled before its response body is read.
  If that response is HTTP 200 after a readable redirect, the browser retries
  the exact Range once at the final CDN URL. That retry must still return HTTP
  206 and pass the same size checks. Range and HEAD requests bypass HTTP caches.
  Opaque, truncated, inconsistent, budget-exceeding, or unsupported responses
  leave the result unverified. Client mode never falls back to server ffprobe. Optional host URL assistance is a separate explicit setting described below.
- The core is approximately 31 MiB before HTTP compression and is loaded only
  after the first source passes CORS/Range validation. It is not in the app-shell
  precache and is never downloaded in server/off mode.
- `PROBE_CLIENT_CONCURRENCY=1` is the default. Set it to `2` to test two
  independent Worker/WASM instances; other values fall back to `1`. This public
  hoster setting works in Node, Docker and build configuration. Restart/reload
  after changing it. Two Workers also require more memory and share the same
  connection; speed and stability must be checked on the actual device.
- With two configured Workers, startup still uses one until the first successful
  metadata result. Source failures do not open the second Worker. After both cores
  have been released for idling, the next startup uses one again.
- The stream list starts candidates in order and fills a free Worker as soon as
  its previous job finishes. Each label updates immediately. FIRST_STREAM startup
  selection still checks in priority order, rather than choosing whichever finishes
  first. Diagnostics include `slot` and `concurrency` to distinguish Workers.
- Initial/random reads are 256 KiB; consecutive
  reads grow to 512 KiB then at most 1 MiB to reduce round trips and ffprobe reruns.
  The last read is clamped to the remaining budget, with at most 13 MiB of
  media data per attempt. File size and seek positions do not allocate a full
  video buffer. Background labels reserve separate bounded resolve and cold-WASM
  phases; auto-selection retains its existing hard deadline.
- The Worker is reused during a batch and terminated after 30 seconds idle.
  Source/range/byte-budget failures release that job without discarding the
  initialized WASM core. Timeouts and Worker failures still terminate the Worker.
  No SharedArrayBuffer, COOP/COEP changes,
  media decoding, remux, or transcoding are required for this probe path.

Server/client results use the same metadata normalizer and device-capability
assessment. Neither mode makes an unsupported codec Direct merely from its name.
See `ffprobe-wasm-NOTICE.txt` for the pinned core's license and source information.

## Temporary client diagnostics

On the Node host, set `NUVIO_CLIENT_PROBE_DEBUG=1`, restart, and reload the app.
The existing in-app Console debug screen captures `[ClientProbe]` events locally.
They show queue time, Worker/WASM stages, timeout/failure reasons and bytes read.
The module does not log source URLs, credentials or native exception messages,
and sends no diagnostic events to the server. The default is off; unset the flag
or set it to `0` after investigating and reload open clients.

## On-demand CDN URL reuse

Probe readers remember the final CORS-readable URL after validating a partial
response, with no separate resolve request. Copy Link and browser downloads use
that page-memory cache; if absent, they resolve only when the action is requested.
Resolution uses HEAD, with a one-byte GET fallback when HEAD is unavailable, and
cancels response bodies without reading media. The cache expires after 60 seconds,
holds at most 100 entries, and is never persisted or logged. Concurrent resolves
share one request sequence. A failed resolve is not cached.

Resolution cannot bypass an upstream redirect that denies CORS. Copy Link then
retains the original addon URL for native-player compatibility. Browser downloads
still obey CORS. Native external-player launches are not forced through this
resolver. Existing credential-based debrid descriptor resolution is separate.

## Optional URL assistance from your NuvioWeb host

`MEDIA_URL_HOST_RESOLVE_ENABLED=false` is the default, independent of
`PROBE_MODE`. Enable it explicitly to let the instance's backend resolve supported
Torrentio/TorBox source links for on-demand CORS consumers. With `PROBE_MODE=client`,
ffprobe still runs in the browser and the server probe endpoint remains disabled.

The browser sends a fixed same-origin POST with credentials in Authorization and
only the source descriptor in JSON. The backend reconstructs one known Torrentio
route, reads its redirect headers without following to media, validates that the
redirect is the same account's fixed TorBox requestdl endpoint, and reads that
endpoint's CDN redirect headers. It returns the URL as JSON without fetching the
video or directly calling torrent creation/account-list APIs. Unsupported providers/URL shapes fail
closed; this is not an arbitrary URL proxy. Responses use Cache-Control: no-store.
The endpoint is also disabled server-side unless explicitly enabled. Docker Compose
passes the flag to both the web container and the debrid API bridge container.

The host necessarily receives the credential and file descriptor. This resolver
adds no database writes, telemetry or credential/request-body logging. That does
not hide the data from the server administrator, override custom proxy logging,
or change existing profile/account-sync storage. Client-side resolved URL caching
remains short-lived and in memory. Use a host you control or trust.

Client background labels may reserve up to 15 seconds for host URL preparation,
then up to 15 seconds for the file probe. Cold WASM initialization has a separate
20-second budget; it does not consume the file probe timer. Warm Workers skip this
phase. Background attempts are capped at 50 seconds including queue time.
Auto-selection keeps its existing total deadline. A failed optional host helper
still allows one normal CORS range request to the original addon URL. When client
probe diagnostics are enabled, host failures include a sanitized hop/status and
TorBox availability checks report duration/status/counts without source URLs or keys.
Manual stream lists with Direct-only disabled finish loading sources before
background client labels add provider requests; Direct-only and auto-selection
continue probing during source loading.

On HTTPS pages, public-domain HTTP media URLs are upgraded to HTTPS before addon
stream mapping, playback, URL resolution, and client probing. Query parameters and
explicit ports are preserved. LAN/IP/local-name URLs and HTTP deployments retain
their original addresses; the client never downgrades after a TLS error. The media
host must actually support HTTPS.

Opt-in diagnostics correlate probe events and playback-label decisions using a
short source tag, without printing URLs or credentials. Failed HTTP range responses
retain only status, content-type category, and an error category from at most 4 KiB
of the error body. Raw response text is discarded. These facts distinguish a CDN
HTTP rejection from a browser CORS failure; they do not treat Unknown as a request
to transcode.
