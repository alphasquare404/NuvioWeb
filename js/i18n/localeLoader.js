export async function loadLocaleMessagesWithFallback(
  locale,
  loadMessages,
  defaultLocale = "en"
) {
  const normalizedLocale = String(locale || defaultLocale).trim().toLowerCase() || defaultLocale;
  const base = await loadMessages("values/strings.xml").catch(() => Object.create(null));
  if (normalizedLocale === defaultLocale) {
    return { ...base };
  }

  const localized = await loadMessages(`values-${normalizedLocale}/strings.xml`).catch(() => null);
  return localized ? { ...base, ...localized } : { ...base };
}
