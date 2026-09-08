function contentLengthOf(response) {
  return Number(response?.headers?.get?.("content-length"));
}

function parsedContentRange(response) {
  const value = String(response?.headers?.get?.("content-range") || "").trim();
  const match = value.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === "*" ? null : Number(match[3])
  };
}

export function createBrowserOfflineDownloadRequestInit(signal, rangeOffset = 0) {
  const offset = Math.max(0, Number(rangeOffset) || 0);
  return {
    signal,
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined
  };
}

function getRangeValidation(response, offset, expectedTotalBytes = null) {
  if (!response?.body) return { valid: false, reason: "missing-response-body" };
  if (offset <= 0) {
    return response?.ok
      ? { valid: true, reason: "full-response" }
      : { valid: false, reason: `failed-full-response-${response?.status || "unavailable"}` };
  }
  const range = parsedContentRange(response);
  if (response?.status !== 206) {
    return { valid: false, reason: `expected-206-received-${response?.status || "unavailable"}` };
  }
  if (range && range.start !== offset) {
    return { valid: false, reason: `content-range-start-${range.start}-does-not-match-${offset}` };
  }
  if (range) return { valid: true, reason: "matching-content-range" };

  const expectedTotal = Number(expectedTotalBytes);
  const contentLength = contentLengthOf(response);
  if (
    Number.isFinite(expectedTotal) &&
    expectedTotal > offset &&
    Number.isFinite(contentLength) &&
    contentLength === expectedTotal - offset
  ) {
    return { valid: true, reason: "matching-206-remaining-content-length" };
  }
  return { valid: false, reason: "missing-or-invalid-content-range" };
}

export function getBrowserOfflineResumePlan(response, offset, expectedTotalBytes = null, rangeHeaderPresent = false) {
  const retainedOffset = Math.max(0, Number(offset) || 0);
  const rangeValidation = getRangeValidation(response, retainedOffset, expectedTotalBytes);
  if (rangeValidation.valid) {
    return { valid: true, decision: "append", reason: rangeValidation.reason, prefixBytes: 0 };
  }

  const expectedTotal = Number(expectedTotalBytes);
  const contentLength = contentLengthOf(response);
  const isVerifiedFullResponse =
    retainedOffset > 0 &&
    rangeHeaderPresent === true &&
    Number(response?.status) === 200 &&
    Number.isFinite(expectedTotal) &&
    expectedTotal > retainedOffset &&
    Number.isFinite(contentLength) &&
    contentLength === expectedTotal &&
    Boolean(response?.body);

  // This is not a bandwidth resume: the origin ignored Range and sent the
  // complete verified object. Preserve the retained OPFS prefix and discard
  // that duplicated network prefix before appending the remaining bytes.
  if (isVerifiedFullResponse) {
    return {
      valid: true,
      decision: "skip-prefix-and-append",
      reason: "verified-full-response-ignoring-range",
      prefixBytes: retainedOffset,
      totalBytes: expectedTotal
    };
  }

  return { valid: false, decision: "restart", reason: rangeValidation.reason, prefixBytes: 0 };
}

export function consumeBrowserOfflineDownloadPrefix(chunk, remainingPrefixBytes = 0) {
  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk || 0);
  const remaining = Math.max(0, Number(remainingPrefixBytes) || 0);
  const consumed = Math.min(remaining, bytes.byteLength);
  return {
    consumed,
    remainingPrefixBytes: remaining - consumed,
    // `subarray()` shares the original stream chunk's backing buffer. Safari's
    // OPFS writer has treated such a view as the complete backing buffer, which
    // writes the discarded prefix again at the skip boundary. `slice()` owns an
    // exact-length buffer so the writer receives only the verified suffix.
    writeChunk: consumed < bytes.byteLength ? bytes.slice(consumed) : null
  };
}

export async function writeBrowserOfflineDownloadResponse({
  reader,
  prefixBytes = 0,
  write,
  onPrefixSkipComplete
} = {}) {
  let remainingPrefixBytes = Math.max(0, Number(prefixBytes) || 0);
  let prefixBytesDiscarded = 0;
  let responseBytesRead = 0;
  let suffixBytesWritten = 0;
  let prefixSkipReported = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    responseBytesRead += bytes.byteLength;
    const prefix = consumeBrowserOfflineDownloadPrefix(bytes, remainingPrefixBytes);
    remainingPrefixBytes = prefix.remainingPrefixBytes;
    prefixBytesDiscarded += prefix.consumed;

    if (!prefixSkipReported && prefixBytes > 0 && remainingPrefixBytes === 0) {
      prefixSkipReported = true;
      await onPrefixSkipComplete?.({ prefixBytesDiscarded });
    }
    if (!prefix.writeChunk?.byteLength) continue;

    await write(prefix.writeChunk);
    suffixBytesWritten += prefix.writeChunk.byteLength;
  }

  return {
    prefixBytesDiscarded,
    remainingPrefixBytes,
    responseBytesRead,
    suffixBytesWritten
  };
}
