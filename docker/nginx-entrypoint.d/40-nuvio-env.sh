#!/bin/sh
set -eu

# This file is served to every browser client. Keep this list explicitly
# browser-public; never add private credentials, tokens, or local.properties.
TARGET=/usr/share/nginx/html/nuvio.env.js
TEMP_TARGET="${TARGET}.tmp"

base64_value() {
  # Base64 keeps quotes, backslashes, query strings, and Unicode values out of
  # JavaScript syntax. The browser decodes the UTF-8 value before assigning it.
  printf '%s' "$1" | base64 | tr -d '\n'
}

write_value() {
  key=$1
  value=$2
  printf '    %s: decode("%s")' "$key" "$(base64_value "$value")"
}

# PROBE_MODE is authoritative; PROBE_ENABLED remains a legacy off switch.
probe_mode=$(printf '%s' "${PROBE_MODE:-}" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
if [ -z "$probe_mode" ]; then
  legacy_probe_enabled=$(printf '%s' "${PROBE_ENABLED:-true}" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  case "$legacy_probe_enabled" in 0|false|no|off|disabled) probe_mode=off ;; *) probe_mode=server ;; esac
fi
case "$probe_mode" in server|client|off) ;; *) probe_mode=off ;; esac
probe_endpoint="${PROBE_ENDPOINT:-}"
[ "$probe_mode" = server ] || probe_endpoint=""
probe_client_concurrency=$(printf '%s' "${PROBE_CLIENT_CONCURRENCY:-1}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
case "$probe_client_concurrency" in 2) ;; *) probe_client_concurrency=1 ;; esac

# Preserve absent mode for legacy delivery; explicit mode overrides its old switch.
remux_mode=$(printf '%s' "${REMUX_MODE:-}" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
remux_endpoint="${REMUX_ENDPOINT:-}"
if [ -n "$remux_mode" ]; then
  case "$remux_mode" in server) ;; *) remux_endpoint="" ;; esac
else
  legacy_remux_enabled=$(printf '%s' "${REMUX_ENABLED:-}" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  case "$legacy_remux_enabled" in 0|false|no|off|disabled) remux_endpoint="" ;; esac
fi
remux_cache=$(printf '%s' "${REMUX_CLIENT_CACHE_MAX_MIB:-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
case "$remux_cache" in
  '') remux_cache=512 ;;
  *[!0-9]*) remux_cache=0 ;;
  *) remux_cache=$(printf '%s' "$remux_cache" | sed 's/^0*//'); remux_cache=${remux_cache:-0}
     if [ "${#remux_cache}" -gt 16 ] || { [ "${#remux_cache}" -eq 16 ] && [ "$remux_cache" -gt 9007199254740991 ]; }; then remux_cache=0
     elif [ "$remux_cache" -lt 128 ]; then remux_cache=0
     elif [ "$remux_cache" -gt 512 ]; then remux_cache=512; fi ;;
esac

if [ -z "${NUVIO_SUPABASE_URL:-}" ] || [ -z "${NUVIO_SUPABASE_ANON_KEY:-}" ]; then
  echo "Nuvio browser configuration is incomplete: Supabase URL and anon key are required." >&2
fi

{
  cat <<'EOF'
(function defineNuvioEnv() {
  function decode(encoded) {
    var binary = atob(encoded);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  }

  var root = typeof globalThis !== "undefined" ? globalThis : window;
  var env = root.__NUVIO_ENV__ || {};
  var values = {
EOF
  write_value NUVIO_SUPABASE_URL "${NUVIO_SUPABASE_URL:-}"; printf ',\n'
  write_value NUVIO_SUPABASE_ANON_KEY "${NUVIO_SUPABASE_ANON_KEY:-}"; printf ',\n'
  write_value NUVIO_SUPABASE_FALLBACK_URL "${NUVIO_SUPABASE_FALLBACK_URL:-}"; printf ',\n'
  write_value YOUTUBE_PROXY_URL "${YOUTUBE_PROXY_URL:-youtube-proxy.html}"; printf ',\n'
  write_value INTRODB_API_URL "${INTRODB_API_URL:-https://api.introdb.app/}"; printf ',\n'
  write_value IMDB_RATINGS_API_BASE_URL "${IMDB_RATINGS_API_BASE_URL:-}"; printf ',\n'
  write_value IMDB_TAPFRAME_API_BASE_URL "${IMDB_TAPFRAME_API_BASE_URL:-}"; printf ',\n'
  write_value AVATAR_PUBLIC_BASE_URL "${AVATAR_PUBLIC_BASE_URL:-}"; printf ',\n'
  write_value UNIQUE_CONTRIBUTIONS_BASE_URL "${UNIQUE_CONTRIBUTIONS_BASE_URL:-}"; printf ',\n'
  write_value DONATIONS_BASE_URL "${DONATIONS_BASE_URL:-}"; printf ',\n'
  write_value DONATIONS_DONATE_URL "${DONATIONS_DONATE_URL:-}"; printf ',\n'
  write_value SPONSOR_NAMES "${SPONSOR_NAMES:-ragmehos.}"; printf ',\n'
  write_value TRAKT_CLIENT_ID "${TRAKT_CLIENT_ID:-}"; printf ',\n'
  write_value SIMKL_CLIENT_ID "${SIMKL_CLIENT_ID:-}"; printf ',\n'
  write_value SIMKL_APP_NAME "${SIMKL_APP_NAME:-nuvio}"; printf ',\n'
  write_value PREMIUMIZE_CLIENT_ID "${PREMIUMIZE_CLIENT_ID:-}"; printf ',\n'
  write_value PROBE_MODE "$probe_mode"; printf ',\n'
  write_value PROBE_CLIENT_CONCURRENCY "$probe_client_concurrency"; printf ',\n'
  write_value MEDIA_URL_HOST_RESOLVE_ENABLED "${MEDIA_URL_HOST_RESOLVE_ENABLED:-false}"; printf ',\n'
  write_value PROBE_ENDPOINT "$probe_endpoint"; printf ',\n'
  write_value REMUX_MODE "$remux_mode"; printf ',\n'
  write_value REMUX_CLIENT_CACHE_MAX_MIB "$remux_cache"; printf ',\n'
  write_value REMUX_ENDPOINT "$remux_endpoint"; printf ',\n'
  write_value TRANSCODE_MODE "${TRANSCODE_MODE:-}"; printf ',\n'
  write_value TRANSCODE_ENDPOINT "${TRANSCODE_ENDPOINT:-}"; printf ',\n'
  write_value AUTOMATION_SHORTCUT_URL "${AUTOMATION_SHORTCUT_URL:-}"
  cat <<'EOF'
  };
  for (var key in values) {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      env[key] = values[key];
    }
  }
  root.__NUVIO_ENV__ = env;
}());
EOF
} > "$TEMP_TARGET"

mv "$TEMP_TARGET" "$TARGET"
