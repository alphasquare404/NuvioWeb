function parseHourCycle(hourCycle) {
  const normalized = String(hourCycle || "").toLowerCase();
  if (normalized === "h11" || normalized === "h12") {
    return true;
  }
  if (normalized === "h23" || normalized === "h24") {
    return false;
  }
  return null;
}

function resolveIntlHour12(intlApi, locale = undefined) {
  try {
    if (typeof intlApi?.DateTimeFormat !== "function") {
      return null;
    }
    const resolved = new intlApi.DateTimeFormat(locale, {
      hour: "numeric"
    }).resolvedOptions();
    if (typeof resolved?.hour12 === "boolean") {
      return resolved.hour12;
    }
    return parseHourCycle(resolved?.hourCycle);
  } catch (_) {
    return null;
  }
}

export function resolveBrowserHour12({ intlApi = null } = {}) {
  return resolveIntlHour12(intlApi);
}

export function buildClockFormatOptions(hour12 = null) {
  const options = {
    hour: "2-digit",
    minute: "2-digit"
  };
  if (typeof hour12 === "boolean") {
    options.hour12 = hour12;
  }
  return options;
}
