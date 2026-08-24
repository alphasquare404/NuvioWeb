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
  write_value SIMKL_APP_NAME "${SIMKL_APP_NAME:-nuvio}"
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
