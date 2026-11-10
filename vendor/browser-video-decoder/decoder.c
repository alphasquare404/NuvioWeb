// SPDX-License-Identifier: LGPL-2.1-or-later
#include <errno.h>
#include <stdint.h>
#include <string.h>

#include <emscripten/emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
#include <libavutil/pixdesc.h>
#include <libswscale/swscale.h>

#define EXPORT EMSCRIPTEN_KEEPALIVE

// Format IDs match softwareVideoDecoder.mjs. Dimensions and strides describe
// tightly packed, planar YUV. Unsupported layouts are converted before copyout.
static const enum AVPixelFormat formats[] = {
    AV_PIX_FMT_YUV420P, AV_PIX_FMT_YUV422P, AV_PIX_FMT_YUV444P,
    AV_PIX_FMT_YUV420P10LE, AV_PIX_FMT_YUV422P10LE, AV_PIX_FMT_YUV444P10LE,
    AV_PIX_FMT_YUV420P12LE, AV_PIX_FMT_YUV422P12LE, AV_PIX_FMT_YUV444P12LE
};

typedef struct {
    AVCodecContext *codec;
    AVPacket *packet;
    AVFrame *frame;
    AVFrame *converted;
    SwsContext *scaler;
    uint8_t *pixels;
    unsigned int pixel_capacity;
    int format;
    int strides[4];
    int size;
    int receive_stage;
} Decoder;

EXPORT void decoder_close(Decoder *decoder) {
    if (!decoder) return;
    avcodec_free_context(&decoder->codec);
    av_packet_free(&decoder->packet);
    av_frame_free(&decoder->frame);
    av_frame_free(&decoder->converted);
    sws_free_context(&decoder->scaler);
    av_free(decoder->pixels);
    av_free(decoder);
}

EXPORT Decoder *decoder_open(int index, const uint8_t *description, int size) {
    const char *const names[] = {"h264", "hevc", "vp8", "vp9", "libdav1d"};
    if (index < 0 || index >= (int)(sizeof(names) / sizeof(*names))) return NULL;
    const AVCodec *codec = avcodec_find_decoder_by_name(names[index]);
    if (!codec) return NULL;
    Decoder *decoder = av_mallocz(sizeof(*decoder));
    if (!decoder) return NULL;
    decoder->codec = avcodec_alloc_context3(codec);
    decoder->packet = av_packet_alloc();
    decoder->frame = av_frame_alloc();
    decoder->converted = av_frame_alloc();
    decoder->scaler = sws_alloc_context();
    if (!decoder->codec || !decoder->packet || !decoder->frame || !decoder->converted ||
        !decoder->scaler) goto fail;

    AVCodecContext *context = decoder->codec;
    context->pkt_timebase = (AVRational){1, 1000000};
    context->thread_count = 1;
    // Bound decoder allocation even if the bitstream disagrees with metadata.
    context->max_pixels = 8192 * 4608;
    if (size > 0) {
        context->extradata = av_mallocz((size_t)size + AV_INPUT_BUFFER_PADDING_SIZE);
        if (!context->extradata) goto fail;
        memcpy(context->extradata, description, size);
        context->extradata_size = size;
    }
    av_log_set_level(AV_LOG_QUIET);
    if (avcodec_open2(context, codec, NULL) < 0) goto fail;
    return decoder;

fail:
    decoder_close(decoder);
    return NULL;
}

EXPORT uint8_t *decoder_packet(Decoder *decoder, int size) {
    av_packet_unref(decoder->packet);
    if (av_new_packet(decoder->packet, size) < 0) return NULL;
    return decoder->packet->data;
}

EXPORT int decoder_send(Decoder *decoder, double timestamp, double duration, int key) {
    AVPacket *packet = decoder->packet;
    packet->pts = (int64_t)timestamp;
    packet->duration = (int64_t)duration;
    packet->flags = key ? AV_PKT_FLAG_KEY : 0;
    int result = avcodec_send_packet(decoder->codec, packet);
    av_packet_unref(packet);
    return result;
}

EXPORT int decoder_drain(Decoder *decoder) {
    return avcodec_send_packet(decoder->codec, NULL);
}

EXPORT void decoder_reset(Decoder *decoder) {
    avcodec_flush_buffers(decoder->codec);
}

static int supported_format(enum AVPixelFormat format) {
    switch (format) {
        case AV_PIX_FMT_YUVJ420P: return 0;
        case AV_PIX_FMT_YUVJ422P: return 1;
        case AV_PIX_FMT_YUVJ444P: return 2;
        default:
            for (int i = 0; i < (int)(sizeof(formats) / sizeof(*formats)); i++)
                if (formats[i] == format) return i;
            return -1;
    }
}

EXPORT int decoder_receive(Decoder *decoder, int supported_formats) {
    AVFrame *frame = decoder->frame;
    decoder->receive_stage = 0;
    int result = avcodec_receive_frame(decoder->codec, frame);
    if (result == AVERROR(EAGAIN) || result == AVERROR_EOF) return 0;
    if (result < 0) return result;

    int format = supported_format(frame->format);
    AVFrame *output = frame;
    if (format < 0 || !(supported_formats & (1 << format))) {
        decoder->receive_stage = 1;
        AVFrame *converted = decoder->converted;
        const AVPixFmtDescriptor *descriptor = av_pix_fmt_desc_get(frame->format);
        if (!descriptor) return AVERROR(EINVAL);
        const int depth = descriptor->comp[0].depth;
        format = 0;
        if (depth > 10 && (supported_formats & (1 << 6)))
            format = 6;
        else if (depth > 8 && (supported_formats & (1 << 3)))
            format = 3;
        av_frame_unref(converted);
        converted->format = formats[format];
        converted->width = frame->width;
        converted->height = frame->height;
        // Keep mastering and dynamic HDR metadata when changing the pixel layout.
        // Otherwise swscale may build a color transform that needs threads.
        result = av_frame_copy_props(converted, frame);
        if (result < 0) return result;
        if (converted->colorspace == AVCOL_SPC_RGB)
            converted->colorspace = AVCOL_SPC_BT709;
        result = sws_scale_frame(decoder->scaler, converted, frame);
        if (result < 0) return result;
        output = converted;
    }

    decoder->receive_stage = 2;
    int size = av_image_get_buffer_size(formats[format], output->width, output->height, 1);
    if (size < 0) return size;
    av_fast_malloc(&decoder->pixels, &decoder->pixel_capacity, size);
    if (!decoder->pixels) return AVERROR(ENOMEM);
    result = av_image_copy_to_buffer(decoder->pixels, size,
        (const uint8_t *const *)output->data, output->linesize, formats[format],
        output->width, output->height, 1);
    if (result < 0) return result;
    result = av_image_fill_linesizes(decoder->strides, formats[format], output->width);
    if (result < 0) return result;
    decoder->format = format;
    decoder->size = size;
    return 1;
}

EXPORT int decoder_receive_stage(const Decoder *decoder) {
    return decoder->receive_stage;
}

EXPORT const int32_t *decoder_info(Decoder *decoder) {
    // The current frame is owned by this decoder until the next receive.
    static int32_t info[11];
    const AVFrame *frame = decoder->frame;
    info[0] = frame->width;
    info[1] = frame->height;
    info[2] = decoder->format;
    info[3] = decoder->strides[0];
    info[4] = decoder->strides[1];
    info[5] = decoder->size;
    info[6] = frame->color_primaries;
    info[7] = frame->color_trc;
    info[8] = frame->colorspace == AVCOL_SPC_RGB ? AVCOL_SPC_BT709 : frame->colorspace;
    info[9] = frame->color_range;
    if (frame->format == AV_PIX_FMT_YUVJ420P || frame->format == AV_PIX_FMT_YUVJ422P ||
        frame->format == AV_PIX_FMT_YUVJ444P)
        info[9] = AVCOL_RANGE_JPEG;
    info[10] = (int32_t)(uintptr_t)decoder->pixels;
    return info;
}

EXPORT double decoder_timestamp(Decoder *decoder) {
    const AVFrame *frame = decoder->frame;
    return (double)(frame->pts == AV_NOPTS_VALUE ? frame->best_effort_timestamp : frame->pts);
}

EXPORT double decoder_duration(Decoder *decoder) {
    return (double)decoder->frame->duration;
}
