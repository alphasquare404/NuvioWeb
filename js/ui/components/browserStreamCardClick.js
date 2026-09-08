export function resolveBrowserStreamCardClickAction(target, contains = () => true) {
  const offlineAction = target?.closest?.("button[data-offline-action]");
  if (offlineAction && contains(offlineAction)) {
    return {
      kind: "offline",
      action: String(offlineAction.dataset?.offlineAction || ""),
      streamId: String(offlineAction.dataset?.streamId || "")
    };
  }

  const sourceCard = target?.closest?.(
    ".stream-route-chip[data-action='setFilter'], .stream-route-card[data-action]"
  );
  if (sourceCard && contains(sourceCard)) {
    return { kind: "source", element: sourceCard };
  }
  return null;
}
