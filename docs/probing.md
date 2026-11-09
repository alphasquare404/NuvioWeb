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
add-on source links for browser probing, offline downloads, copying stream links, and client remux. With `PROBE_MODE=client`,
ffprobe still runs in the browser and the server probe endpoint remains disabled.

For Torrentio/TorBox, the browser sends a fixed same-origin POST with credentials in Authorization and
only the source descriptor in JSON. The backend reconstructs one known Torrentio
route, reads its redirect headers without following to media, validates that the
redirect is the same account's fixed TorBox requestdl endpoint, and reads that
endpoint's CDN redirect headers. It returns the URL as JSON without fetching the
video or directly calling torrent creation/account-list APIs. Unsupported providers/URL shapes fail
closed; this is not an arbitrary URL proxy. Responses use Cache-Control: no-store.
The endpoint is also disabled server-side unless explicitly enabled. Docker Compose
passes the flag to both the web container and the debrid API bridge container.

Other add-ons can use the same flag without individual entries. The host only
connects to public HTTPS destinations on port 443. It checks all DNS answers
at each hop and pins the connection to those checked IPs while retaining TLS
verification for the hostname. The resolver follows at most four redirects
and discards response bodies. It returns the final URL to the browser.
The browser still needs CORS and byte ranges on the media server. Client
remux requests host assistance after its original Range fetch fails.

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

### Client probe result reuse

An independent Playback > General setting, Filter streams by device compatibility,
offers Off (default), Likely Direct, and Likely Direct + Remux. It estimates from
addon names/descriptions/filenames and the current browser's native codec and
container capability snapshot, without resolving a URL or reading media. Query
tokens are excluded from text inspection. Enabled filters omit incomplete,
unverified text and conversion candidates from manual lists, automatic selection
and probe candidates before their limit. Disabling labels does not disable this
filter. Addon label scope, metadata candidate limits, HDR preference and the chosen
label source's Only Direct checks still apply afterward. This text estimate is not a verified label;
Off restores all text-filtered sources. No Movi-specific behavior is introduced.
The setting is saved per local player profile. Playback group reorganization is
still a separate design discussion.

Next Episode treats Binge Group as a preference: missing hints or an unavailable
matching group fall back to the ordinary auto-next selection policy. A provisional
preferred-only lookup can wait while addons are still loading, but it does not
make the final fallback require a group. Source permissions, compatibility/HDR
filters and verified Direct requirements still apply.

For Next Episode, a positive Stream Selection Timeout bounds addon lookup, source
retrieval and probing together. Only one selection runs at a time; each probe
receives the remaining budget. At expiry, an already verified eligible Direct
candidate can be used, otherwise the stream picker opens. Late results cannot
restart selection or replace its result. Instant chooses the first eligible
arrival (with the existing 45-second retrieval safety bound); Unlimited waits for
addon completion without that 45-second overall cap. Individual probe requests
remain bounded. File facts obtained late may still be reusable in the probe cache.

The stream page, detail auto-selection, player panels and Next Episode share the
same candidate policy. A complete torrent hash plus file index counts as one
file across addons; incomplete identities fall back to exact source URLs. The
first eligible occurrence represents the file, preserving ordering and HDR
priority. Duplicate cards may share verified facts without spending another
candidate slot. Names or file sizes are not sufficient to merge candidates.

Settings > Streams offers Label based on: File metadata (Accurate, Slow), the
default, or File name (Inaccurate, Fast). Metadata labels use the existing probe
pipeline and cache. Filename labels use local addon text/filenames and current
native browser capabilities, with no probe, worker, URL resolution or metadata
cache lookup; badges explicitly say estimate. Incomplete text remains Unknown.
Filename mode ignores prior probe facts for label decisions and uses text for HDR.

Labeling requires its toggle enabled and an explicit addon selection in Settings

> Streams; an empty selection displays `Choose` and performs no label probing.
> Only Direct is hidden and inactive unless both requirements are met. Turning
> labels off or clearing selected addons in Settings also saves Only Direct off;
> runtime guards ignore old stale Only Direct flags. When enabled, Only Direct uses
> the chosen label source: probe verification for metadata, estimates for filename.
> With Only Direct off, sources from all addons remain visible, subject to the
> independent text compatibility filter.

In client metadata mode, a profile may label at most 3, 5, 8 or 10 candidates per source
list (default 5), combined across selected addons. The host's nonzero
`PROBE_PAGE_LIMIT` may lower this cap; a zero host limit cannot remove the client
cap. Addon scope and existing HDR priority apply before the cap, and First Stream
retains source order. Detail startup, stream page, player source panels and
Direct-only next-episode selection use the same cap. This setting limits candidate
count; it does not change the deployment's Worker concurrency. Unselected addons
and candidates beyond the client metadata cap do not draw playback labels. The
limit is hidden and unused in filename mode. The label source, limit and addon
choices are saved in the local profile's stream badge settings.

Client result metadata is cached in RAM by each `createStreamProber` instance.
Successful file facts with a full torrent hash and file index are also stored
locally in IndexedDB (`nuvio-probe-metadata`, schema 1), for 30 days and at most
1,000 files. Only normalized metadata fields are stored: no source/CDN URLs,
credentials, raw ffprobe output, diagnostics or browser compatibility decisions.
Successful results and in-flight jobs share a key for a full torrent info hash plus file
index. Supported Torrentio/TorBox and StremThru Torz URLs expose those fields;
structured stream descriptors (including TB Instant) can supply them too.
Unknown URL shapes retain exact-URL keys. Names, sizes and incomplete identities
are never sufficient. Distinct files remain distinct, and failed URLs do not
prevent an alternative URL from being tried. Each caller reassesses browser
capabilities, and a selection caller retains its own wait deadline. Reloading
clears RAM but retains IndexedDB results on the same browser/origin. Independent
prober instances can reuse those persisted facts. Sources without a strong file
identity remain RAM-only. A failed/blocked/quota-limited database does not prevent
live probing; cache lookup waits at most 150 ms within the caller's budget.
Settings > Advanced > Cache > Clear Probe Cache empties IndexedDB and invalidates
RAM results in the current page; reopen the stream list to refresh its labels.
Other open tabs should be reloaded after clearing. Pending pre-clear probes
cannot repopulate the cleared cache. CDN URL resolution has its separate
60-second memory cache described above.

### Client MKV attachments and label progress

For metadata-only client probes, the sparse file view replaces structurally located
Matroska Attachments headers with equivalent EBML Void headers. The file offsets
and every track/media byte are preserved; font/artwork payloads are skipped, not
downloaded or replaced with fabricated media. The parser uses bounded Segment and
SeekHead traversal and never searches arbitrary packet contents. Other containers
and unrecognized/malformed layouts keep the existing probe behavior and budgets.
This view is confined to ffprobe: playback and embedded text subtitle readers
continue to read the original source. The download cap remains 13 MiB.

Both server and client metadata labels distinguish Waiting (not yet checked),
Checking (owned pending probe work), and Unknown (failed/unavailable metadata).
Successful metadata replaces those statuses with the playback method. The optional
filename fallback remains a user preference; these changes never enable it.
Cold client WASM initialization still takes time independently of media reads.

### Playback when metadata remains unavailable

Filename fallback controls estimated labels. With it disabled, an unverified source
starts Direct. A confirmed format refusal automatically tries the hoster's configured
remux path once. An unverified Direct startup that presents no frame has an absolute
15-second limit (including metadata waiting) and may try that same copy path once.
Known network/access/HTTP failures, aborts and autoplay refusals do not trigger it.
The startup error screen no longer has a Try remux button.

If that remux attempt fails with format/unsupported-media evidence or stalls before
startup, an explicitly configured server audio endpoint may be considered once.
Actual probe facts and device assessment must confirm supported video and audio-only
conversion; unknown metadata or a playable alternate track cannot authorize encoding.
The existing server delivery uses video copy and AAC audio. No client encoding or
video encoding is enabled. A client deployment without that server endpoint does not
send media or initiate an audio-conversion probe for this step. Explicit retry and
original-URL actions remain; the automatic ladder never loops. Pending resume state
and stale-source protection remain in place. Fallback transitions emit only route
names in diagnostics, without source URLs or tokens.

### URL-less candidates and the metadata label limit

The metadata label limit belongs to the labeling queue, independently of Instant
Playback URL preparation. Client candidates no longer require that preparation to
finish before entering their label slot. A full torrent hash plus file index can
retrieve cached facts before any URL, debrid request or WASM/media probe. An empty
URL probe with such an identity is strictly cache-only: a miss never starts media
reading and does not record a negative result.

On a cache miss, a URL-less candidate uses the existing debrid resolver when its
bounded probe slot runs, then probes that actual URL. Resolution waits at most
15 seconds; stale results cannot mutate the list or start a media probe. Unsupported
or failed resolution reaches a terminal failure status and the existing retry
policy, rather than leaving an unowned Waiting label indefinitely. This same
candidate flow is used by the player source list. Source filters/sorting and the
independent Instant Playback preparation settings/budgets are unchanged.

Cached metadata identifies a file, not an episode title. Different releases or
files of the same title need their own result; incomplete identities never reuse
another file's persistent facts. Network, URL resolution, byte and codec failures
can still produce Unknown; setting a limit of10 does not promise10 successful files.

### Queue concurrency

Client probe concurrency is configured with PROBE_CLIENT_CONCURRENCY=1 or2.
Two-worker mode publishes the first successful WASM result before starting the
second worker; it then fills each free lane without waiting for its peer. Cached
metadata does not need a WASM worker. The local client acceptance preview is set
to2; deployments retain their own configured value and existing memory/byte limits.

Server labeling has five independent request lanes. Each lane resolves and probes
its own candidate, so there is no whole-list URL preparation barrier and a slow
candidate cannot hold the next group. Missing URLs use the same bounded candidate
helper and finish with a result or failure status. Existing server bridge resource
limits still apply; browser worker concurrency does not change server process limits.

### Shared selection policy (November 2026)

Playback badges are presentation only. Background checks have their own addon
scope and quota. Compatibility filters recognize any actual file facts already
available, including selection results and local cache entries outside that
background scope/quota. With checks off, the compatibility filter is inactive;
legacy disabled-check preferences remain disabled. Filename-mode filtering uses
local estimates rather than spending metadata probe slots. Metadata-mode filters
still require actual facts: a filename fallback badge cannot authorize encoding
or turn Unknown metadata into a verified match.

Initial automatic selection and next episode share the cache-first candidate
inspection helper. A selected URL-less debrid descriptor can reuse metadata by
strong file identity; otherwise the existing resolver obtains its URL. Source
addon/plugin permissions and regex are applied before binge preference. Existing
HDR exclusions and ranking remain in force. First Source stops after the highest
priority eligible match; parallel background completions do not decide selection
priority. Unknown/unmatched sources lead to the picker, not relaxed rules.

Manual initial selection stays manual. Prefer Binge Group alone cannot enable
automatic source selection. Explicit Auto Next may choose the next source while
initial selection is Manual, but retains selected addon/plugin permissions.
Remembered links must also pass current source, regex and compatibility constraints.
Reuse Binge Group remains a preference, not an exception to those constraints.

Instant starts discovery and chooses on the first eligible arrival without waiting
for every addon; it has the existing next-episode 45-second discovery safety cap.
Unlimited waits for addon completion. Numeric timeouts carry one deadline through
source discovery and compatibility inspection; a source already collected may be
selected at the deadline only if the applicable rules are satisfied. Individual
network/probe limits remain bounded. The separate 15-second unverified Direct
playback fallback begins after source selection, not during discovery.

Known facts travel with player handoffs and route snapshots. Cache-only client
hydration can read up to 1,000 strong file identities in ten local-storage lanes;
it never resolves URLs or starts a media/WASM probe. Cache generation invalidates
older snapshots. Selection probes are cancelled at their deadline and stale results
cannot replace a new selection. User selection pauses background auto selection.

The stream-picker entry point uses that same compatibility pass when its automatic
source has no known eligible result. Selection temporarily preempts background
label work, retaining positive facts and allowing unfinished background candidates
to resume afterward. Candidate/settings revisions can trigger a new bounded pass;
manual user selection invalidates the pending automatic pass. A matching candidate
already available can still be selected without unnecessary reinspection.

Initial detail discovery may verify partial candidate sets while addon requests
continue. It never stops on a raw candidate rejected by the compatibility filter.
Instant can finish on the first verified match; Unlimited verifies the complete
revision before selection. Previously verified facts are carried into the next pass,
so a later addon arrival does not require re-reading the same file. Verifier failure
falls back to the picker and cannot spin/retry a single failed revision indefinitely.
Selected-file inspection uses the host discovery cap (client safety maximum20),
independently of the user's background label quota; existing facts are still valid
outside both quotas and no automatic path broadens source/regex permissions.

## Current playback lifecycle: selected sources only (2026-11-01)

This supersedes earlier list-labeling/compatibility-filter workflows above. Lists and autoplay discovery do not inspect media. Playback labels and their controls are deferred. Legacy profile fields remain readable but inactive.

Only the selected file is resolved/inspected, using existing client/server readers and the strong-file-identity metadata cache. Player chooses Direct, configured copy remux, or evidence-authorized server audio conversion. Prepared manifests skip probing. Failed metadata permits bounded Direct/fallback attempts. Filename estimates cannot choose routes or authorize encoding. Existing RAM, range-read, initialization and cache budgets remain.

Manual terminal preparation failures return to the picker with a notice. Automatic startup retries respect source permissions/regex/preferences and try each stable file identity once. Partial discovery can retrieve later rows without widening addon scope. Exhaustion opens the manual picker. Back invalidates selection and stops the reader/media session at every loading stage, including Continue Watching and next-episode discovery.

Delivery belongs to PlayerScreen and the extracted selectedStreamDelivery helper, preserving the existing HLS alternate-audio producer. selectedPlaybackTask bounds preparatory waiting and responds to cancellation. Video encoding and client encoding remain unavailable. Connected-server filtering/sorting is unchanged.

Validation: scoped lint/build pass;1652 tests pass;asset b6458506dc89. Physical client/server acceptance pending; changes are uncommitted on the isolated integration candidate.

## Filename estimates and fast initial routing (2026-11-01)

This supersedes the previous label deferral and required startup probe. Fusion Style offers filename-only playback labels at the front of the badge row. Labels remain estimates even if metadata is cached. The independent Audio & Video filename filter defaults ALL, with DIRECT and DIRECT_REMUX choices and an explicit warning about false exclusions/Unknown rows. Lists, autoplay, retries, saved links, next episodes and source/episode/detail/season selectors share the same policy. Retired metadata-check settings remain inactive. No list probing or connected-server sorting/filter edits were introduced.

filenamePlaybackRoutingEnabled is enabled by default in Audio & Video. It may select initial Direct, configured copy remux or server audio-only conversion from filename/device estimates, without waiting for a separate probe. Off tries Direct, remux, then supported server audio conversion. Actual cached facts are preferred when available. Actual demuxing and selected audio/subtitle discovery still read the source. Without filename permission, audio conversion requires actual selected-source evidence. Video encoding and client encoding remain unavailable; every audio conversion plan copies video.

Each route is tracked to prevent loops and duplicate starts. Direct startup15s; processed startup/preparation30s. Source network/access/autoplay errors are not conversion evidence. Back cancels preparatory work and prevents late URLs/errors; relay waits reject superseded generations. Terminal failure returns manual users to the picker or advances autoplay within its permitted candidates. Known alternative audio can remain copy-only; known multi-audio rendition information is retained.

Validation: lint/build pass;1674 tests pass;asset fe490e0a54b9. Uncommitted isolated integration candidate. Publication of this exact bundle was explicitly approved. Both public previews now serve asset fe490e0a54b9, verified by bundle SHA256 and runtime mode. Client still has no audio-server endpoint. Device acceptance remains pending.


## Episode drawer and server HLS recovery — 2026-11-02

- Removed the final deleted renderPlayerStreamLabel call from browser episode-source cards. It threw while rendering the open drawer, leaving an invisible input-blocking panel. A regression renders real episode-stream markup, including loaded, loading and empty states.
- Automatic route admission now refuses an already-tried route at the execution boundary; explicit user retries remain available. Regressions cover duplicate Direct entry and processing-service 502 followed by a single Direct attempt and exhaustion. The exact origin of the repeated Direct calls in the device log has not been reproduced; the boundary invariant is now enforced.
- Existing HLS delivery recreates completed jobs when their cached playlist disappeared, including normal admission limits for replacement work. An unfinished producer returns 503/Retry-After rather than a false 502. Completed output without media remains a failure. Playlist completion is sampled before asynchronous reading to avoid rejecting a file written during an in-flight read.
- No new delivery route, video/client encoding, list probing, or connected-server filter/sort changes. The user-supplied H.264/E-AC3 MKV was readable by ffprobe and produced HLS through the existing bridge in an isolated localhost diagnostic. The public server returned 502 for the same source; no device-level acceptance is claimed yet.

Validation: build ea94f11d41ae and scoped ESLint pass; all 1681 tests pass with test-concurrency=4. Both public test frontends serve the matching bundle (HTTP 200), with client/server runtime modes preserved and no client audio-server endpoint. Existing server preview updated with the HLS handler fix; user-supplied source returned HTTP 200 with one ready segment in 5777ms after restart. Physical drawer/playback acceptance remains pending; no commit or branch merge was made.
