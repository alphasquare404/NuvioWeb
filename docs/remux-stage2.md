# Client remux integration (stage 2)

Host policy: REMUX_MODE=client opts into local packet-copy remux. Existing unset
mode retains legacy delivery. Live host settings are not changed by this work.
Independent server HLS remains unavailable until stage 3. Audio conversion is
still separately configured; client errors never trigger a media relay or encoder.

The selected source is assessed for the browser first. Direct-capable sources
stay direct. The initial client adapter reads Matroska with AVC and the selected
AAC stereo audio track, then appends fragmented MP4 through MSE/ManagedMediaSource.
Other layouts/codecs remain unvalidated for this adapter, even when the browser
or another route could support them. No downmix or video/audio encoder is added.
Actual track enumeration and known probe facts are checked before packet copying.
Saved own relay URLs are unwrapped with their audio ordinal; arbitrary HLS and
audio-conversion URLs are not rewritten as remux.

## Storage and prerequisites

Secure context, Workers, supported output MIME, writable OPFS including Worker
sync access handles, browser-readable CORS and validated byte ranges are required.
The proven HEAD/length alternative applies when Content-Range is hidden; a full
200 response is rejected rather than downloaded into RAM. Credentials are omitted;
explicit stream request headers are forwarded subject to normal browser rules.

Warm OPFS cache is bounded by the host cap (default/max 512 MiB), a quarter of
estimated free quota, and a 128 MiB minimum. Disabled/low-quota/other-owner warm
cache uses bounded OPFS staging if it remains writable. No whole-file RAM fallback.
Compressed playback and packet/write budgets remain the lab limits; browser and
decoder allocations are additional. Web Locks protect cache and active staging
runs. Safe orphan cleanup touches only the owned remux namespace; unrelated
offline files are preserved. Without Web Locks, warm caching/orphan sweeping is
disabled, while session staging still cleans on normal stop.

## Player ownership

PlayerController owns the adapter and all seek paths. Buffered seeks reuse the
current media; other seeks try OPFS then source. Logical duration and last valid
position survive MediaSource replacement. Pause intent and rate survive seeks.
Restoring does not report false completion or launch another episode. Stop/source
replacement awaits adapter cleanup before the next source starts. Progress keeps
the existing source identity; no blob/cache/job identity is stored in accounts.
Audio changes start an isolated output/cache session at the same logical position.

Text subtitle metadata appears under the existing Built-in tab. One removable
native cue layer receives the selected language's bounded windows; existing player
size/color/offset/delay presentation applies. Language changes do not remux AV;
audio changes preserve the selected subtitle. Off and external subtitle selection
clear the embedded layer. Bitmap subtitles and advanced ASS effects are excluded.
Cold subtitle fetch may follow video; current state is available in the runtime
snapshot. User-facing loading/privacy/badge refinement belongs to stage 4.

Client media requests go directly from browser to source. Separately configured
server probe/host-resolve assistance can still receive the source URL. Client mode
does not make that separate assistance local. ManagedMediaSource disables remote
playback for this adapter; native fullscreen behavior still depends on the browser.

## Assets and verification

Mediabunny 1.62.1 is pinned to the lab version (MPL-2.0). The build emits a small
lazy runtime and two local Workers under one content-versioned assets directory;
workers reject another protocol version. None is added to app-shell precache.
The dependency license is shipped beside the assets; its source is available in
the pinned npm package. No lab UI, fixture URL, or Movi runtime is imported.

Focused acceptance covers original identity/audio ordinal, direct/legacy routing,
restore progress and terminal guards, disk cap/quota/ownership/cleanup, and asset
version mismatches. A real-browser local smoke uses the actual PlayerScreen
startup, Controller, runtime/Workers, Built-in selection and cue presentation for
resume, forward/back OPFS seek, pause/rate, language/audio changes, Off and cleanup.
Physical Safari/PWA lab results remain prior evidence, not a new production-device
acceptance claim. Stage 2 baseline verification: npm test passed 1,577 tests with no failures; npm run build passed. New modules passed targeted ESLint; targeted formatting and git diff checks passed. The browser smoke also passed second-owner staging, subtitle delay/external selection and native-error cleanup.

No connected-server filter/sorting, account preference migration or active host
configuration changes are included. The final shared route badges/filter messages
and deployment device acceptance remain stage 4; server copy/HLS remains stage 3.
Rollback by disabling client mode or returning to the prior unset/legacy settings.

## Startup follow-up and current acceptance

The subsequent startup work adds selected-audio preroll, bounded buffering,
ordered initial seek/play, manual Play recovery and sanitized failure-stage
diagnostics. The last verified implementation passed 1,600 tests and a build.
Frame diagnostics use the standard playback-quality counter before the optional
WebKit counter; an unavailable counter is not reported as zero.

On 29 October 2026 the user reported successful iPhone playback after earlier
startup stalls. No code change occurred during that final investigation. The
previous stall cause remains unproven; neither RAM, storage nor OS updates are
established as its cause. This checkpoint is not full production acceptance.
The main video retains autoplay while isolation/smoke harnesses do not, leaving
a startup verification gap; this has not been established as the stall trigger.
No controller rewrite or new speculative startup patch was applied. Server HLS
and final route/privacy UI remain deferred.
