# ffmpeg is the whole point of this image: the bridge copies the picture and
# re-encodes only the audio track, so the binary has to be present and current.
FROM node:22-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY services/transcode-bridge ./services/transcode-bridge
COPY services/remux-bridge/bridge.mjs ./services/remux-bridge/bridge.mjs
COPY services/shared/egressBudget.mjs ./services/shared/egressBudget.mjs
COPY services/shared/ffmpegRuntime.mjs ./services/shared/ffmpegRuntime.mjs
COPY js/core/player/clientRemux/range.mjs js/core/player/clientRemux/mkvTextSubtitles.mjs js/core/player/clientRemux/mkvSubtitleCues.mjs ./js/core/player/clientRemux/

# Transcodes are written under the OS temporary directory, which the deployment
# can point at a volume so a restart does not throw away work already paid for.
# The bridge sweeps its own files by age either way. Created here so the mounted
# volume inherits an owner the unprivileged user can write to.
ENV TRANSCODE_WORK_DIR=/tmp/nuvio-transcode
RUN mkdir -p /tmp/nuvio-transcode && chown -R node:node /tmp/nuvio-transcode

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/transcode/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "services/transcode-bridge/server.mjs"]
