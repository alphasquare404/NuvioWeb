import { lookup as systemLookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { parseHttpsPlaybackUrl } from "./addonPlaybackPolicy.mjs";

// Keep local, shared, documentation, benchmark, multicast and other special
// networks out of this outbound resolver.
const blocked = new BlockList();
for (const [address, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
])
  blocked.addSubnet(address, bits, "ipv4");
for (const [address, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20]
])
  blocked.addSubnet(address, bits, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

function isPublicAddress({ address, family }) {
  if (isIP(address) !== family || address.includes("%")) return false;
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

function lookupWithAbort(hostname, lookup, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => lookup(hostname, { all: true }))
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function resolvePublicAddresses(url, lookup = systemLookup, signal) {
  const addresses = await lookupWithAbort(url.hostname, lookup, signal);
  if (!addresses.length || !addresses.every(isPublicAddress)) {
    throw Object.assign(Error("non-public-address"), { statusCode: 403 });
  }
  signal.throwIfAborted();
  return addresses;
}

export function checkedAddressLookup(addresses) {
  return (_hostname, options, done) => {
    const approved = options.family
      ? addresses.filter(({ family }) => family === options.family)
      : addresses;
    if (!approved.length) return done(Error("no-checked-address"));
    if (options.all) return done(null, approved);
    return done(null, approved[0].address, approved[0].family);
  };
}

export function requestPublicAddonHeaders(url, addresses, signal, requestImpl = request) {
  return new Promise((resolve, reject) => {
    const upstream = requestImpl(
      url,
      {
        method: "GET",
        agent: false,
        signal,
        headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" },
        // Do not let the socket resolve the hostname again after validation.
        lookup: checkedAddressLookup(addresses)
      },
      (response) => {
        resolve({
          status: response.statusCode,
          location: response.headers.location,
          type: response.headers["content-type"]
        });
        response.destroy();
      }
    );
    upstream.once("error", reject);
    upstream.end();
  });
}

export async function resolvePublicAddonRedirect(
  source,
  { requestHeaders = requestPublicAddonHeaders, lookup = systemLookup, signal }
) {
  let url = source;
  const visited = new Set();
  for (let hop = 0; hop <= 4; hop++) {
    if (visited.has(url.href)) return null;
    visited.add(url.href);
    const addresses = await resolvePublicAddresses(url, lookup, signal);
    const upstream = await requestHeaders(url, addresses, signal);
    if ([200, 206].includes(upstream.status)) {
      const type = upstream.type || "";
      return hop > 0 &&
        !/^(?:text\/html|application\/(?:json|problem\+json|xhtml\+xml))\b/i.test(type)
        ? url.href
        : null;
    }
    if (![301, 302, 303, 307, 308].includes(upstream.status) || !upstream.location || hop === 4)
      return null;
    const target = parseHttpsPlaybackUrl(new URL(upstream.location, url).href);
    if (!target) throw Object.assign(Error("invalid-redirect-target"), { statusCode: 403 });
    url = target;
  }
  return null;
}
