# Remux deployment policy (stage 1)

Historical stage 1 snapshot. Client integration is now described in remux-stage2.md.

REMUX_MODE accepts off, client, server (case insensitive). Explicit mode overrides
REMUX_ENABLED. Unset mode preserves legacy effective endpoints/delivery; defaults
remain off. Unknown mode disables remux. REMUX_ENDPOINT is server-only.

Client adapter and independent server HLS are not installed in stage 1. Explicit
client/server remux requests show unavailable before any media relay request,
including saved /api/remux URLs and configured transcode-copy playlist URLs. Direct and independent audio-transcode remain on
their existing paths. Leave REMUX_MODE unset to keep an existing legacy deployment.

REMUX_CLIENT_CACHE_MAX_MIB defaults to 512; integer values 128..512 are accepted,
larger safe integers clamp to 512; 0, invalid values and values 1..127 disable warm
cache. This is a future adapter disk budget, not a RAM limit; OPFS staging is still
required. No live host settings are modified by adding this policy.

Client media remux will be local. Server probe/host resolve remain separately
configured assistance; no automatic client-to-server fallback is authorized.
No player controller/screen changes, connected-server filter/sorting changes,
new codec/encoder support or Movi integration are part of this stage.

Rollback: unset REMUX_MODE and restore the previous switches/endpoints. No account
data migration is performed. See the reviewed integration design for stages 2–4.
