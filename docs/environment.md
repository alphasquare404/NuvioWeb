# Environment configuration

NuvioWeb reads Docker environment values from the `.env` file beside
`docker-compose.yml`. Copy `.env.example` to `.env` for a deployment. Never
commit your real `.env` file.

## Self-hosting modes

### Frontend-only self-hosting (recommended)

Run the NuvioWeb containers yourself and keep the default Nuvio backend values
from `.env.example`:

```text
NuvioWeb self-host -> hosted Nuvio backend
```

This is the easiest setup. You do not need a Supabase project, a separate
Nuvio backend, or a newly generated Supabase anon key. The provided anon key is
a browser-public publishable client identifier, not a password, service-role
key, database password, or other private server secret.

Using this mode self-hosts the frontend only. Profile and account data use the
hosted Nuvio backend.

### Full self-hosting (advanced)

Run NuvioWeb plus an official compatible Nuvio backend. Replace these values in
`.env` with the values from that backend:

| Backend output    | NuvioWeb variable         |
| ----------------- | ------------------------- |
| `BACKEND_URL`     | `NUVIO_SUPABASE_URL`      |
| `PUBLISHABLE_KEY` | `NUVIO_SUPABASE_ANON_KEY` |

The official backend can provide these values with `./nuvio credentials`. Leave
`NUVIO_SUPABASE_FALLBACK_URL` empty unless you operate a fallback backend. A
compatible backend can expose its discovery document at
`<BACKEND_URL>/.well-known/nuvio`.

Do not create a random empty Supabase project: it is not a compatible Nuvio
backend.

## Variable reference

### Backend and web server

| Variable                      | Required | Visibility                | Default                                             | Purpose and empty behavior                                                                                                                                                                                           |
| ----------------------------- | -------- | ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NUVIO_SUPABASE_URL`          | Yes      | Browser-public            | `https://api.nuvio.tv`                              | Hosted Nuvio backend URL. Keep the default for frontend-only deployment; replace it with `BACKEND_URL` for full self-hosting. Empty disables normal account/backend access.                                          |
| `NUVIO_SUPABASE_ANON_KEY`     | Yes      | Browser-public            | Hosted Nuvio publishable anon key in `.env.example` | Public client identifier for the backend. Keep the default for frontend-only deployment; replace it with `PUBLISHABLE_KEY` for full self-hosting. Empty prevents account sign-in. Never use a service-role key here. |
| `NUVIO_SUPABASE_FALLBACK_URL` | Optional | Browser-public            | `https://api-two.nuvioapp.space`                    | Fallback hosted backend URL. For full self-hosting, leave empty unless you run a fallback.                                                                                                                           |
| `NUVIO_PORT`                  | Optional | Host-only Compose setting | `4173`                                              | Host port mapped to Nginx. Change it when `4173` is unavailable.                                                                                                                                                     |
| `YOUTUBE_PROXY_URL`           | Optional | Browser-public            | `youtube-proxy.html`                                | Browser proxy helper path for YouTube-related playback. Empty disables that override.                                                                                                                                |
| `TV_LOGIN_WEB_BASE_URL`       | Optional | Browser-public            | Empty                                               | Address the television sign-in QR code points at. Empty uses the address the app is served from, which is correct unless the television build is served from somewhere the phone scanning the code cannot reach.     |
| `TMDB_API_KEY`                | Optional | Browser-public            | Empty                                               | Built-in TMDB key used as a fallback. A key entered in Settings by the person using the app always takes precedence, so this only covers anyone who has not set one. Empty means every user supplies their own.      |

### Return-to-NuvioWeb notifications (optional)

This optional feature sends a notification after an external player reports
playback progress or completion. Tapping it returns the user to the installed
NuvioWeb PWA. It is a convenience only: external playback and external-return
progress/completion reporting continue to work when notifications are not
available.

| Variable                     | Required | Visibility      | Purpose and empty behavior                                                                                                                                                     |
| ---------------------------- | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NUVIO_WEB_PUSH_PUBLIC_KEY`  | Optional | Browser-public  | Public VAPID key used when a user enables return notifications. Empty leaves the feature unavailable.                                                                          |
| `NUVIO_WEB_PUSH_PRIVATE_KEY` | Optional | **Server-only** | Private VAPID key used only by `external-return-bridge` to send notifications. Never expose it to browser runtime configuration or logs. Empty leaves the feature unavailable. |
| `NUVIO_WEB_PUSH_SUBJECT`     | Optional | Server-only     | VAPID contact URI, such as `mailto:admin@example.com` or a suitable HTTPS URI. Empty leaves the feature unavailable.                                                           |

Generate a matching key pair on the self-host server:

```bash
npx --yes web-push@3.6.7 generate-vapid-keys
```

No separate global or manual `web-push` installation is required. If needed,
`npx` downloads and runs `web-push@3.6.7`; `--yes` accepts that temporary
installation without prompting. The command generates only a Public Key and
Private Key. Copy them into `NUVIO_WEB_PUSH_PUBLIC_KEY` and
`NUVIO_WEB_PUSH_PRIVATE_KEY`, respectively.
Set `NUVIO_WEB_PUSH_SUBJECT` separately to a contact URI, such as
`mailto:admin@example.com` or an appropriate HTTPS URI; the command does not
generate the subject. Do not commit the real `.env` file or generated private
key. The public VAPID key is intentionally browser-visible; the private key is
not.

Production Service Worker and Web Push use requires HTTPS. When using Nginx
Proxy Manager, Caddy, Traefik, or another reverse proxy, access NuvioWeb via
HTTPS before enabling Return-to-NuvioWeb notifications. Plain HTTP LAN access
is not a production Web Push setup. Localhost development can be treated as a
secure-context exception by browsers.

If VAPID is not configured, permission is denied, Push is unsupported, a
subscription is unavailable, or delivery fails, normal NuvioWeb usage and
external playback still work. The callback/manual Home Screen return path stays
available; only the notification-based return convenience is unavailable.

### Return to NuvioWeb by Shortcuts Automation (optional, iPhone)

On iPhone and iPad an alternative to the notification above is a Shortcuts
Automation: it runs when the external player closes and opens NuvioWeb, so
progress is collected without anything to tap. It needs no relay, no keys and
no subscription.

The Shortcut itself is two actions — Open URL, pointing at
`webapp://<your host>/`, the scheme that opens a web app already added to the
Home Screen on iOS 16.4 and later. **A Shortcut therefore carries the address
it opens**, so a Shortcut published for one deployment opens that deployment
on anyone's phone.

| Variable                  | Required | Visibility     | Default | Purpose and empty behavior                                                                                                                                                                                                                      |
| ------------------------- | -------- | -------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTOMATION_SHORTCUT_URL` | Optional | Browser-public | Empty   | An iCloud link to a Shortcut you published **for your own domain**. When set, iPhone users get a one-tap Add the Shortcut button. Empty shows them the address for this deployment and how to paste it into a new Shortcut, which always works. |

Leave it empty unless you published your own. Never copy another deployment's
link: your users would install a Shortcut that opens someone else's instance.

To publish one: build a Shortcut with a single Open URL action set to
`webapp://<your host>/`, then Share it and choose Copy iCloud Link.

The option is offered only on iOS, and only once NuvioWeb is installed to the
Home Screen — the Shortcut has nothing to open until then.

### Optional integrations

| Variable               | Required | Visibility      | Default                     | Purpose and empty behavior                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | -------- | --------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIMKL_CLIENT_ID`      | Optional | Browser-public  | Empty                       | Enables Simkl integration when configured. Obtain the public client identifier from [Simkl API documentation](https://api.simkl.com/). Empty leaves Simkl unavailable.                                                                                                                                                                                                                |
| `SIMKL_APP_NAME`       | Optional | Browser-public  | `nuvio`                     | Display/application name passed to Simkl. Leave the default unless your Simkl registration requires another value.                                                                                                                                                                                                                                                                    |
| `PREMIUMIZE_CLIENT_ID` | Optional | Browser-public  | Empty                       | Enables Premiumize Device Code authentication. Register an OAuth client through [Premiumize API documentation](https://www.premiumize.me/api). Empty keeps Premiumize connection unavailable.                                                                                                                                                                                         |
| `TRAKT_CLIENT_ID`      | Optional | Browser-public  | Empty                       | Public Trakt application identifier for browser sign-in. Obtain it from the [Trakt application settings](https://app.trakt.tv/settings/apps). Empty keeps Trakt sign-in unavailable; it is the only value the bridge now requires.                                                                                                                                                    |
| `TRAKT_CLIENT_SECRET`  | Optional | **Server-only** | Empty                       | Private Trakt application credential, for applications that were issued one. It is passed only to `trakt-auth-bridge`, never written to `nuvio.env.js` or exposed to browser JavaScript. Trakt no longer issues a secret to applications that sign users in and treats it as deprecated for that purpose, so leaving it empty is now normal: the bridge sends it only when it exists. |
| `TRAKT_REDIRECT_URI`   | Optional | **Server-only** | `urn:ietf:wg:oauth:2.0:oob` | Redirect URI registered with Trakt; it must match the application configuration. Empty uses the Compose default. See [Trakt authentication](https://docs.trakt.tv/reference/auth).                                                                                                                                                                                                    |
| `MDBLIST_CLIENT_ID`    | Optional | **Server-only** | Empty                       | MDBList application identifier used only by `mdblist-bridge` for device authorization. Each browser user connects their own MDBList account; this is never a shared user token. Empty keeps MDBList sign-in unavailable.                                                                                                                                                              |

In general, a `CLIENT_ID` is a public application identifier, while a
`CLIENT_SECRET` is private and belongs only on a server. Do not put access
tokens, refresh tokens, provider credentials, Supabase service-role keys,
database passwords, or signing keys in browser runtime configuration.

### Advanced browser-public endpoint overrides

These are optional endpoints used by the browser build. Leave them blank to use
the application defaults unless you intentionally operate compatible services.

| Variable                        | Default                    | Purpose and empty behavior                                                              |
| ------------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| `INTRODB_API_URL`               | `https://api.introdb.app/` | Intro metadata API base URL. Empty uses the app default.                                |
| `IMDB_RATINGS_API_BASE_URL`     | Empty                      | Optional IMDb ratings endpoint override. Empty uses the app default behavior.           |
| `IMDB_TAPFRAME_API_BASE_URL`    | Empty                      | Optional legacy-compatible IMDb endpoint override. Empty uses the app default behavior. |
| `AVATAR_PUBLIC_BASE_URL`        | Empty                      | Optional public avatar endpoint override. Empty uses the app default behavior.          |
| `UNIQUE_CONTRIBUTIONS_BASE_URL` | Empty                      | Optional contributions endpoint override. Empty uses the app default behavior.          |
| `DONATIONS_BASE_URL`            | Empty                      | Optional donations API endpoint override. Empty uses the app default behavior.          |
| `DONATIONS_DONATE_URL`          | Empty                      | Optional donation-page URL override. Empty uses the app default behavior.               |
| `SPONSOR_NAMES`                 | Empty                      | Optional comma-separated sponsor names. Empty uses the built-in default.                |

## Applying changes

After changing `.env`, recreate the containers so Nginx receives the updated
public runtime configuration:

```bash
docker compose up -d --force-recreate
```

Keep all four Docker `image:` tags in `docker-compose.yml` aligned when
switching between `stable`, `nightly`, `latest`, or a pinned `X.Y.Z` release.

### Remux and transcoding

`REMUX_MODE=off|client|server` selects container-copy delivery. An empty value retains legacy endpoint-based selection. Node deployments also enable the existing relay with `REMUX_ENABLED=true`; Docker deployments set the public endpoint URLs explicitly. Server mode uses the existing copy/HLS relay; it does not require a separate remux-session service.

- Client: MediaBunny reads its supported source formats and copies encoded packets into fragmented MP4. The output format and the browser's actual MediaSource/ManagedMediaSource codec support decide eligibility. The remux path leaves the encoded tracks intact. The pinned remux worker skips Matroska font/artwork attachment payloads, which are unused by the text-only subtitle path. This avoids whole-attachment allocations without raising source-read/cache budgets; the modified module source is shipped beside the MediaBunny license. HTTPS, workers, byte-range/CORS access and OPFS are required. Unsupported source/output combinations fail explicitly.
- Server: FFmpeg copies video and audio on the existing HLS path. No codec-family whitelist is imposed on alternate audio; device refusals and actual codec-transition support still govern selection. A format unsupported by the HLS/MP4 muxer can still fail; FFmpeg recognition alone does not guarantee browser playback.
- Audio conversion: the separate `TRANSCODE_ENDPOINT` path may copy video and encode audio to AAC. Its label is orange Transcoding.

Full video conversion is opt-in and requires a successful probe showing a video incompatibility.

Set `TRANSCODE_MODE` in `local.properties` for Node preview or in the Compose environment:

- `none`: Do not transcode audio or video.
- `client`: Mediabunny and WebCodecs produce fragmented MP4. Audio-only conversion keeps the video packets and encodes audio to AAC. Full conversion encodes H.264/AAC up to 4K UHD when supported, without upscaling. The device must support decoding the source tracks it converts.
- `server`: FFmpeg converts audio or full video. Full output is H.264/AAC HLS up to 1080p. Compose requires `TRANSCODE_ENDPOINT`; Node preview uses its local bridge. Access mode, token, concurrency, cache, and `TRANSCODE_TIMEOUT_MS` apply.

An unset mode preserves legacy server audio delivery when an endpoint is configured. Explicit modes keep conversion in the selected location.

`REMUX_CLIENT_CACHE_MAX_MIB` controls the bounded OPFS disk cache (128–512 MiB), independently of the compressed RAM buffer limits. Neither path loads an entire movie into browser RAM. Server segments use the existing bounded disk-cache lifecycle.

Client remux does not send media to the remux server. `PROBE_MODE=server` independently permits server metadata probing; optional host URL resolution also sends the required source credentials/descriptor to that instance. Use `PROBE_MODE=client` and disable host URL assistance when all source processing must remain on-device; source CORS/range restrictions then apply without a server fallback.

The shared relay token is entered at Settings → Playback → Audio & Video → Transcode token. Moving this field preserves the stored token. Metadata labeling has an opt-in filename fallback; an exclamation in a circle explains why the estimate was used. Filename estimates never authorize audio or video encoding. Failed background checks retry once after at least 15 seconds; selecting a stream cancels active and queued labeling and checks the selected stream first when no previous failure is known. A failed or inconclusive check does not block manual Play: a Remux filename estimate chooses a copy-only attempt; other unverified labels try the original URL. An initial format/decoder failure may try the configured copy route once. Network/access failures do not trigger automatic conversion, and remux failure never loops back automatically. The error UI offers manual original-URL and retry actions.

Client probe caching distinguishes successful file facts from failures. Successful persistent entries require a stable torrent hash and file index and last up to30days; an episode title alone is not an identity. Byte-budget failures are remembered in page memory for10minutes to avoid repeating the same bounded download on navigation, then can be tried again. A full reload clears that failure memory. Transient network failures retain the existing retry policy. Checking denotes actual pending work, not merely an enabled probing feature. With filename fallback disabled, an inconclusive/non-running check remains Unknown; an ambiguous Direct startup failure offers a manual Try remux action without changing the labeling setting.

## FFmpeg server dependency

Node.js server installs include the pinned optional `ffmpeg-static` dependency.
With a normal `npm ci`, its install script downloads the binary for the server's
platform. It stays on the server and is not copied into the browser build. Client
remux continues to use Mediabunny and does not execute a server binary.

Executable selection is `FFMPEG_PATH`, then the packaged binary, then `ffmpeg`
on `PATH`. An explicitly configured `FFMPEG_PATH` is authoritative: if it fails,
the server does not silently switch to another executable. This can point at a
standard FFmpeg installation or a compatible Jellyfin build; Jellyfin is not
required. If optional dependencies or install scripts are omitted, install
FFmpeg on the server or set this override before enabling server processing.

The transcode-bridge Docker image already installs FFmpeg using Alpine's package
manager, so no separate host installation is needed. In Compose, `FFMPEG_PATH`
refers to an executable **inside that container**.

At startup the Node server and standalone transcode bridge check the executable,
MP4/HLS muxers, HTTP/HTTPS protocols, and AAC and libx264 encoders with bounded local commands.
No media URL is fetched for these checks. Health responses expose verified
capability booleans without executable paths. Missing FFmpeg capabilities return 503
instead of starting a job. The Node preview omits unavailable local processing
endpoints from its public config; explicitly configured remote endpoints remain
independent of the local executable.

Onboarding verifies server health before advertising server remux or audio
transcoding. An older bridge without verified capability fields, an unreachable
service, or a missing binary does not advertise those features in onboarding.
Existing playback policy is unchanged for older bridge responses. Installing
FFmpeg does not enable remux or audio transcoding automatically: host switches,
access rules, and budgets still apply.
