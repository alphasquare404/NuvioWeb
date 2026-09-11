<div align="center">

  <img src="assets/brand/app_logo_wordmark.png" alt="NuvioWeb" width="300" />
  <br />
  <br />

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![License][license-shield]][license-url]

  <p>
    An independent community fork of Nuvio for browser and PWA playback.
    <br />
    Desktop • Mobile • Tablet • Offline-capable PWA
  </p>

</div>

## About

NuvioWeb is an independent, GPL-3.0-licensed community fork maintained by
alphasquare. It is based on Nuvio, preserves upstream attribution, and uses an
independent release lifecycle: 0.1.0 is the first community-fork release;
0.1.1 denotes bug fixes; 0.2.0 denotes meaningful changes; and 1.0.0 will mark
the first stable release. NuvioWeb is not affiliated with or endorsed by
NuvioMedia.

NuvioWeb acts as a client-side playback interface that can integrate with the Stremio addon ecosystem for content discovery and source resolution through user-installed extensions.

## Development

### Prerequisites

- Node.js
- npm
- Python 3, for local static hosting

### Setup

```bash
git clone https://github.com/alphasquare404/NuvioWeb.git
cd NuvioWeb
npm install
```

### Run the Web App Locally

```bash
npm run build
python3 -m http.server 8080 -d dist
```

Open:

```text
http://127.0.0.1:8080
```

## Self-host with Docker

The default Compose deployment pulls the published
`ghcr.io/alphasquare404/nuvioweb:desktop` image. It serves the browser build
from Nginx, does not run the development Node server, and does not require a
local source build on the server.

### Configure public browser values

Provide browser-public values through an untracked `.env` file next to
`docker-compose.yml`. The required values for account sign-in are:

```dotenv
NUVIO_SUPABASE_URL=https://your-project.supabase.co
NUVIO_SUPABASE_ANON_KEY=your-browser-anon-key

# Optional: enables browser Trakt device sign-in through the internal bridge.
# TRAKT_CLIENT_SECRET is supplied only to the bridge, never to the browser.
TRAKT_CLIENT_ID=
TRAKT_CLIENT_SECRET=

# Optional: enables browser Simkl PIN sign-in
SIMKL_CLIENT_ID=
SIMKL_APP_NAME=nuvio

# Optional: enables Premiumize Device Code sign-in in Connected Services.
# This is a public OAuth client identifier, not a Premiumize user credential.
PREMIUMIZE_CLIENT_ID=

# Optional: expose the container on another host port (default: 4173)
NUVIO_PORT=4174
```

`NUVIO_SUPABASE_FALLBACK_URL` and the existing public
metadata/avatar/donation endpoint overrides are also supported. Their defaults
work for most deployments. TMDB remains profile-configurable in Settings rather
than a required Docker value.

Docker builds a generic browser image. At container startup, an explicit
public allowlist is written to `nuvio.env.js`, so changing `.env` only requires
recreating the container, not rebuilding the image:

```bash
docker compose up -d --force-recreate
```

`TRAKT_CLIENT_ID`, `SIMKL_CLIENT_ID`, `SIMKL_APP_NAME`, and
`PREMIUMIZE_CLIENT_ID` are browser-public runtime values. The frontend receives
only `TRAKT_CLIENT_ID`; `TRAKT_CLIENT_SECRET` and `TRAKT_REDIRECT_URI` are
server-only values passed exclusively to the internal `trakt-auth-bridge`
container. Nginx routes only `/api/trakt/*` to that sidecar; neither server
value is written to `nuvio.env.js`, bundled, or exposed on a host port. Never
place Supabase service-role keys, access tokens, provider credentials, or other
private values in browser runtime configuration.

### Start and update

Run these commands on the Docker/self-host server. The server only needs this
Compose file and its local `.env`; it does not need a source checkout to build
the application. Your development machine only needs to commit and push source
changes; Docker is not required on it.

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Open `http://SERVER_IP:4173`.

```bash
# Follow server logs
docker logs -f nuvioweb

# Stop the application
docker compose down

# Update to the newest published desktop image
docker compose pull
docker compose up -d
```

The container serves HTTP on port `80` and Compose maps it to host port `4173`.
It can sit behind an external reverse proxy such as Nginx Proxy Manager, Caddy,
or Traefik for HTTPS and a custom domain; TLS is intentionally not bundled into
this application container.

## Project Structure

- `js/` contains app logic, UI screens, platform adapters, and player code.
- `css/` contains shared responsive styling.
- `assets/` contains icons, branding, and bundled assets.
- `docs/` contains static runtime helper pages used by the app.
- `scripts/` contains browser build, serving, and metadata tooling.
- `dist/` contains generated build output.

## Origins / Credits

This browser/PWA project builds on important community work:

- **tapframe/NuvioTV**
  The original project that shaped Nuvio's product direction.
  https://github.com/tapframe/NuvioTV

- **WhiteGiso/NuvioTV-WebOS**
  An early inspiration for this web codebase.
  https://github.com/WhiteGiso/NuvioTV-WebOS

NuvioWeb builds on that foundation for browsers and installed PWAs. It also
includes web/community work by WhiteGiso, edoedac0, and other contributors.

## Legal & DMCA

NuvioWeb functions solely as a client-side interface for browsing metadata and playing media provided by user-installed extensions and/or user-provided sources. It is intended for content the user owns or is otherwise authorized to access.

NuvioWeb is not affiliated with any third-party extensions, catalogs, sources, or content providers. It does not host, store, or distribute any media content.

For comprehensive legal information, including our full disclaimer, third-party extension policy, and DMCA/Copyright information, please visit our [Legal & Disclaimer Page](https://nuvioapp.space/legal).

## Built With

- JavaScript
- HTML
- CSS
- Node.js build tooling
- Stremio addon ecosystem

## Star History

<a href="https://star-history.dera.page/#alphasquare404/NuvioWeb&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=alphasquare404/NuvioWeb&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=alphasquare404/NuvioWeb&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=alphasquare404/NuvioWeb&type=date&legend=top-left" />
 </picture>
</a>

<!-- MARKDOWN LINKS & IMAGES -->

[contributors-shield]: https://img.shields.io/github/contributors/alphasquare404/NuvioWeb.svg?style=for-the-badge
[contributors-url]: https://github.com/alphasquare404/NuvioWeb/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/alphasquare404/NuvioWeb.svg?style=for-the-badge
[forks-url]: https://github.com/alphasquare404/NuvioWeb/network/members
[stars-shield]: https://img.shields.io/github/stars/alphasquare404/NuvioWeb.svg?style=for-the-badge
[stars-url]: https://github.com/alphasquare404/NuvioWeb/stargazers
[issues-shield]: https://img.shields.io/github/issues/alphasquare404/NuvioWeb.svg?style=for-the-badge
[issues-url]: https://github.com/alphasquare404/NuvioWeb/issues
[license-shield]: https://img.shields.io/github/license/alphasquare404/NuvioWeb.svg?style=for-the-badge
[license-url]: https://github.com/alphasquare404/NuvioWeb/blob/main/LICENSE
