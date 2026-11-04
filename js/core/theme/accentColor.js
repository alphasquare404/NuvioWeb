export function normalizeAccentColor(value) {
  const text = String(value || "").trim();
  const short = text.match(/^#?([0-9a-f]{3})$/i);
  if (short)
    return (
      "#" +
      [...short[1]]
        .map((c) => c + c)
        .join("")
        .toLowerCase()
    );
  const full = text.match(/^#?([0-9a-f]{6})$/i);
  return full ? "#" + full[1].toLowerCase() : null;
}

export function accentTextColor(value) {
  const hex = normalizeAccentColor(value) || "#1e88e5";
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}
