#!/usr/bin/env bash
set -euo pipefail

# See README.md for the pinned inputs and required tools.
work=$(cd "$1" && pwd)
out=$(cd "$2" && pwd)
source_dir=$(cd "$(dirname "$0")" && pwd)
cross_file=$(realpath "${3:-$source_dir/emscripten.ini}")
jobs=${BUILD_JOBS:-4}

# dav1d uses the Emscripten pthread stubs with one decode thread. Drop Meson's
# automatic -pthread so the decoder can load without cross-origin isolation.
dav1d_source="$work/dav1d-single-thread"
if [[ ! -d "$dav1d_source" ]]; then
  mkdir -p "$dav1d_source"
  git -C "$work/dav1d" archive HEAD | tar -x -C "$dav1d_source"
  sed -i "s/thread_dependency = dependency('threads')/thread_dependency = declare_dependency()/" \
    "$dav1d_source/meson.build"
fi
meson setup "$work/dav1d-single-thread-build" "$dav1d_source" --cross-file "$cross_file" \
  --buildtype release --default-library static --prefix "$work/dav1d-install" \
  --libdir lib -Denable_asm=false -Denable_tools=false -Denable_tests=false
meson compile -C "$work/dav1d-single-thread-build" -j "$jobs"
meson install -C "$work/dav1d-single-thread-build"

mkdir -p "$work/ffmpeg-build"
cd "$work/ffmpeg-build"
PKG_CONFIG_PATH="$work/dav1d-install/lib/pkgconfig" \
  "$work/ffmpeg/configure" --arch=wasm32 --target-os=none --enable-cross-compile \
  --cc=emcc --ar=emar --ranlib=emranlib --nm="${LLVM_NM:-llvm-nm}" --host-cc="${HOST_CC:-cc}" \
  --disable-everything --disable-autodetect --disable-programs --disable-doc \
  --disable-avdevice --disable-avformat --disable-avfilter --disable-swresample \
  --disable-network --disable-asm --disable-pthreads --disable-stripping \
  --enable-avcodec --enable-swscale --enable-libdav1d \
  --enable-decoder=h264,hevc,vp8,vp9,libdav1d \
  --optflags='-O3'
make -j "$jobs" libavcodec/libavcodec.a libavutil/libavutil.a libswscale/libswscale.a

emcc -O3 -I. -I"$work/ffmpeg" "$source_dir/decoder.c" \
  libavcodec/libavcodec.a libswscale/libswscale.a libavutil/libavutil.a \
  "$work/dav1d-install/lib/libdav1d.a" --no-entry \
  -sENVIRONMENT=worker,node -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=25165824 -sMAXIMUM_MEMORY=536870912 \
  -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP32 \
  -o "$out/software-video.js"
