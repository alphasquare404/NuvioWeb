// Deployment policy, independent of user preferences and stream label settings.
export function normalizeClientProbeConcurrency(value) {
  return String(value ?? "").trim() === "2" ? 2 : 1;
}

export function normalizeProbeMode(mode = "", legacyEnabled = "") {
  const value = String(mode || "")
    .trim()
    .toLowerCase();
  if (["server", "client", "off"].includes(value)) return value;
  if (value) return "off";
  return ["0", "false", "no", "off", "disabled"].includes(
    String(legacyEnabled).trim().toLowerCase()
  )
    ? "off"
    : "server";
}
