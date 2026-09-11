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

NuvioWeb runs from published GHCR images. A self-host server needs only Docker
Compose, `docker-compose.yml`, and `.env`; it does not need a source checkout,
Node.js, npm, or a local image build.

### Quick Deploy with Docker

On the server, create an empty deployment directory and download the Compose
file and configuration template:

```bash
mkdir -p nuvioweb
cd nuvioweb

curl -fsSL \
  https://raw.githubusercontent.com/alphasquare404/NuvioWeb/web/docker-compose.yml \
  -o docker-compose.yml

curl -fsSL \
  https://raw.githubusercontent.com/alphasquare404/NuvioWeb/web/.env.example \
  -o .env
```

For the normal frontend-only deployment, the downloaded `.env` already uses the
hosted Nuvio backend defaults, so you can start NuvioWeb immediately:

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Open `http://SERVER_IP:4173`. Set `NUVIO_PORT` in `.env` before starting if
you need a different host port. You can also edit `.env` for Simkl, Premiumize,
Trakt, or a custom/self-hosted compatible Nuvio backend. See
[environment configuration](docs/environment.md) for every supported value.

### Configuration

The downloaded `.env` template includes safe hosted-backend defaults and labels
browser-public versus server-only values. Do not create an empty Supabase
project for the frontend-only mode. Replace the Nuvio backend values only when
you operate your own compatible backend; the full mapping and advanced options
are in [environment configuration](docs/environment.md).

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

### Release Channels

Use the default `:stable` tag for normal self-hosting. To switch channels, edit
all three `image:` tags in `docker-compose.yml` to the same tag before pulling.

| Tag | Meaning |
| --- | --- |
| `stable` | Recommended. Latest official release. |
| `nightly` | Latest development build from `web`; may be unstable. |
| `latest` | Most recently published project build, whether development or release. |
| `X.Y.Z` | Pinned immutable release, such as `0.1.0`. |
| `desktop` | Temporary legacy compatibility alias. |

Examples: use `:stable` for the recommended channel, `:nightly` for the latest
web development build, `:latest` for the newest published build of any kind,
or `:0.1.0` to remain on a specific release.

### Start, Stop, and Update

Run these commands from the deployment directory.

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

# Update the selected image channel
docker compose pull
docker compose up -d
```

With `:stable`, this updates to the newest official release. With `:nightly`,
it updates to the newest `web` development build. With `:latest`, it updates to
whichever project build was published most recently. A pinned tag such as
`:0.1.0` remains pinned until you edit all three image tags manually.

### Reverse Proxy

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
[license-url]: https://github.com/alphasquare404/NuvioWeb/blob/web/LICENSE
