# Connect Seerr to NuvioWeb

NuvioWeb connects to Seerr directly from the browser. If the apps have different origins, the reverse proxy in front of Seerr must allow NuvioWeb to use the Seerr API with your session cookie. Missing CORS headers can show up as “Could not reach this server from the browser,” even when Seerr opens in its own tab. Seerr does not have a built-in CORS allowlist.

## Nginx Proxy Manager

1. In Nginx Proxy Manager, open **Hosts → Proxy Hosts** and edit the host for Seerr.
2. Open **Custom Locations**. Add `/api/v1/` or edit it if it already exists. Use the same **Scheme**, **Forward Hostname / IP**, and **Forward Port** as in **Details**.
3. Open the gear icon on that location. Paste the rules below into its configuration box and save. Replace `https://nuvio.example.com` with the origin in your NuvioWeb address bar (scheme, hostname, and port if applicable, without a trailing slash).

```nginx
add_header Access-Control-Allow-Origin "https://nuvio.example.com" always;
add_header Access-Control-Allow-Credentials "true" always;
add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
add_header Access-Control-Allow-Headers "Content-Type" always;

if ($request_method = OPTIONS) {
    return 204;
}
```

For Caddy, Traefik, or another proxy, apply the same rules to Seerr's API. The browser requires an explicit origin when it uses cookies. A Seerr API key still requires CORS from a browser and carries administrative access.

## Verify the connection

1. In NuvioWeb, go to **Settings → Content & Discovery → Servers → Seerr**. Choose **Sign in with Seerr** for a local Seerr account or **Sign in with Jellyfin** to use your Jellyfin username and password. Enter the Seerr URL for either method.
2. Open **My Requests**. If sign-in fails, check the browser's Network panel. The `OPTIONS` request to `/api/v1/auth/local` or `/api/v1/auth/jellyfin` should show HTTP 204 and the exact NuvioWeb origin. The API response should include that same origin and `Access-Control-Allow-Credentials: true`.
3. If preflight succeeds but login or sending a request fails, check the actual API response and Seerr logs. Seerr's optional CSRF protection is separate from CORS. Browsers can also block session cookies when the apps are hosted on unrelated domains.
4. If Seerr responds with HTTP 403, try the same sign-in method on your Seerr website. With Jellyfin, enter your Jellyfin username. With a local Seerr account, enter your Seerr email.

References: [Seerr network settings](https://docs.seerr.dev/using-seerr/settings/network/), [Seerr authentication](https://docs.seerr.dev/api/seerr-api/), and [Nginx response headers](https://nginx.org/en/docs/http/ngx_http_headers_module.html).
