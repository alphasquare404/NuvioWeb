const phases = new Set([
  "runtime-import",
  "runtime-create",
  "release-playback",
  "cache-close",
  "storage-cleanup",
  "cache-open",
  "subtitle-worker",
  "renderer-open",
  "producer-start",
  "cache-run",
  "staging-lock",
  "media-worker"
]);
const names = new Map([
  ["UnknownError", "unknown-error"],
  ["QuotaExceededError", "quota-exceeded"],
  ["InvalidStateError", "invalid-state"],
  ["SecurityError", "security-error"],
  ["NotAllowedError", "not-allowed"],
  ["NotFoundError", "not-found"],
  ["AbortError", "aborted"],
  ["TypeError", "type-error"]
]);
// Browser exception messages may contain URLs or misleading example causes.
// Record only our fixed phase and exception class, before cleanup can obscure it.
export async function runStartupStep(
  phase,
  operation,
  report = (facts) => console.warn("[ClientRemux] startup-failure", facts)
) {
  if (!phases.has(phase)) throw Error("invalid-startup-phase");
  try {
    return await operation();
  } catch (error) {
    if (error?.remuxStartupPhase) throw error;
    const exception = names.get(error?.name) || "operation-failed";
    const reason = error?.message === "sourceopen-timeout" ? "sourceopen-timeout" : exception;
    const failure = new Error("client-startup-" + phase + "-" + reason);
    failure.remuxStartupPhase = phase;
    try {
      report({ phase, exception, reason });
    } catch {}
    throw failure;
  }
}
