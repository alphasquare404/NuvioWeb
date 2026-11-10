import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Input, MATROSKA, BufferSource, EncodedPacketSink } from "mediabunny";
import initialize from "../../../../vendor/browser-video-decoder/software-video.js";

test("software AV1 decoder preserves HDR metadata when an 8-bit pixel layout is required", async () => {
  // Synthetic yuv420p10le AV1 with BT.2020, PQ and a mastering display OBU.
  const bytes = await readFile(new URL("../fixtures/av1-hdr10.mkv", import.meta.url));
  const input = new Input({ source: new BufferSource(bytes), formats: [MATROSKA] });
  const wasm = await initialize();
  const track = await input.getPrimaryVideoTrack();
  const config = await track.getDecoderConfig();
  const description = new Uint8Array(config.description || []);
  const pointer = description.length ? wasm._malloc(description.length) : 0;
  if (pointer) wasm.HEAPU8.set(description, pointer);
  const decoder = wasm._decoder_open(4, pointer, description.length);
  wasm._free(pointer);
  try {
    assert.ok(decoder);
    let frames = 0;
    for await (const packet of new EncodedPacketSink(track).packets()) {
      const packetPointer = wasm._decoder_packet(decoder, packet.data.length);
      assert.ok(packetPointer);
      wasm.HEAPU8.set(packet.data, packetPointer);
      assert.equal(
        wasm._decoder_send(
          decoder,
          Math.round(packet.timestamp * 1e6),
          Math.round(packet.duration * 1e6),
          packet.type === "key" ? 1 : 0
        ),
        0
      );
      let result;
      // Only I420 is advertised, as on browsers without planar 10-bit support.
      while ((result = wasm._decoder_receive(decoder, 1)) > 0) {
        const info = wasm._decoder_info(decoder) / Int32Array.BYTES_PER_ELEMENT;
        const [width, height, format, , , , primaries, transfer, matrix] = wasm.HEAP32.subarray(
          info,
          info + 9
        );
        assert.deepEqual(
          [width, height, format, primaries, transfer, matrix],
          [160, 90, 0, 9, 16, 9]
        );
        frames++;
      }
      assert.equal(result, 0);
    }
    assert.ok(frames > 0);
  } finally {
    wasm._decoder_close(decoder);
    input.dispose();
  }
});
