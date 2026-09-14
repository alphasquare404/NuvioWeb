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

### Return-to-NuvioWeb notifications (optional)

This optional feature sends a notification after an external player reports
playback progress or completion. Tapping it returns the user to the installed
NuvioWeb PWA. It is a convenience only: external playback and external-return
progress/completion reporting continue to work when notifications are not
available.

| Variable | Required | Visibility | Purpose and empty behavior |
| --- | --- | --- | --- |
| `NUVIO_WEB_PUSH_PUBLIC_KEY` | Optional | Browser-public | Public VAPID key used when a user enables return notifications. Empty leaves the feature unavailable. |
| `NUVIO_WEB_PUSH_PRIVATE_KEY` | Optional | **Server-only** | Private VAPID key used only by `external-return-bridge` to send notifications. Never expose it to browser runtime configuration or logs. Empty leaves the feature unavailable. |
| `NUVIO_WEB_PUSH_SUBJECT` | Optional | Server-only | VAPID contact URI, such as `mailto:admin@example.com` or a suitable HTTPS URI. Empty leaves the feature unavailable. |

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

### Optional integrations

| Variable               | Required | Visibility      | Default                     | Purpose and empty behavior                                                                                                                                                                    |
| ---------------------- | -------- | --------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIMKL_CLIENT_ID`      | Optional | Browser-public  | Empty                       | Enables Simkl integration when configured. Obtain the public client identifier from [Simkl API documentation](https://api.simkl.com/). Empty leaves Simkl unavailable.                        |
| `SIMKL_APP_NAME`       | Optional | Browser-public  | `nuvio`                     | Display/application name passed to Simkl. Leave the default unless your Simkl registration requires another value.                                                                            |
| `PREMIUMIZE_CLIENT_ID` | Optional | Browser-public  | Empty                       | Enables Premiumize Device Code authentication. Register an OAuth client through [Premiumize API documentation](https://www.premiumize.me/api). Empty keeps Premiumize connection unavailable. |
| `TRAKT_CLIENT_ID`      | Optional | Browser-public  | Empty                       | Public Trakt application identifier for browser sign-in. Obtain it from the [Trakt application settings](https://app.trakt.tv/settings/apps). Empty keeps Trakt sign-in unavailable.          |
| `TRAKT_CLIENT_SECRET`  | Optional | **Server-only** | Empty                       | Private Trakt application credential. It is passed only to `trakt-auth-bridge`, never written to `nuvio.env.js` or exposed to browser JavaScript. Empty leaves the bridge unconfigured.       |
| `TRAKT_REDIRECT_URI`   | Optional | **Server-only** | `urn:ietf:wg:oauth:2.0:oob` | Redirect URI registered with Trakt; it must match the application configuration. Empty uses the Compose default. See [Trakt authentication](https://docs.trakt.tv/reference/auth).            |

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
