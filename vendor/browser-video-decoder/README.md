# Browser video decoder

This build uses FFmpeg's H.264, HEVC, VP8 and VP9 decoders and dav1d for AV1.
Nuvio passes compressed packets from Mediabunny into the module. The module
keeps the decoder state across packets and returns decoded frames for
Mediabunny to encode with WebCodecs. Each playback worker owns its WASM heap.
ProRes continues to use the Mediabunny extension.

FFmpeg is distributed under LGPL-2.1-or-later with this configuration. dav1d
uses BSD-2-Clause. The distributed license files accompany the WASM.
The wrapper and build files are in the software-video-source directory of the
distributed build. The build uses the pinned upstream revisions
below. The build uses Emscripten 4.0.23, GNU Make, pkg-config, Meson 1.8.5 and
Ninja 1.13.0. Add the Emscripten LLVM tools to PATH or set the LLVM_NM variable.

- FFmpeg 8.1.2 at 38b88335f99e76ed89ff3c93f877fdefce736c13
  https://github.com/FFmpeg/FFmpeg/tree/38b88335f99e76ed89ff3c93f877fdefce736c13
- dav1d 1.5.3 at b546257f770768b2c88258c533da38b91a06f737
  https://github.com/videolan/dav1d/tree/b546257f770768b2c88258c533da38b91a06f737
- Emscripten SDK 4.0.23
  https://github.com/emscripten-core/emsdk/tree/4.0.23

With the Emscripten environment active, clone those revisions under a work
directory as `ffmpeg` and `dav1d`. From the NuvioWeb root, run the build below
using a Bash shell. Set `BUILD_JOBS` to control parallel compilation. The regular
NuvioWeb build uses the checked-in results, so it does not require a compiler.

```sh
bash vendor/browser-video-decoder/build.sh /path/to/work vendor/browser-video-decoder
```

An optional third argument selects a Meson cross file for the local toolchain.
