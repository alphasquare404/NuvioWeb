/* global __NUVIO_BUILD_STAMP__ */

/**
 * How a captured console event is read, on screen and in the clipboard.
 *
 * These live apart from the screen because the screen reaches the router and
 * the router reaches the screen back -- a cycle that makes the serializer
 * untestable if it sits in there. They are also the single answer to "what does
 * this event say", which the rendered card and the copied text have to agree on
 * or a pasted log stops matching the screen it was read from.
 */

export function formatEventTime(timestamp) {
  const date = new Date(Number(timestamp || 0));
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function eventLevelLabel(event) {
  return event?.level === "error" ? "ERROR" : "WARN";
}

export function eventMessage(event) {
  return event?.args?.length ? event.args.join("\n\n") : event?.message || "";
}

/**
 * The log as plain text, for pasting into a bug report.
 *
 * A log read off a phone screen is a log nobody reports accurately, so the copy
 * carries its environment with it: which build and which browser produced these
 * lines is usually the first question asked about them.
 */
export function buildLogText(events = [], { runtime = globalThis } = {}) {
  const list = Array.isArray(events) ? events : [];
  const header = [
    `Nuvio console log — ${new Date().toISOString()}`,
    `build: ${typeof __NUVIO_BUILD_STAMP__ === "undefined" ? "unbundled" : __NUVIO_BUILD_STAMP__}`,
    `events: ${list.length}`,
    `url: ${String(runtime?.location?.href || "-")}`,
    `userAgent: ${String(runtime?.navigator?.userAgent || "-")}`
  ];
  const body = list.map(
    (event) =>
      `[${formatEventTime(event?.timestamp)}] #${event?.id} ${eventLevelLabel(event)}\n${eventMessage(event)}`
  );
  return [...header, "", ...body].join("\n");
}
