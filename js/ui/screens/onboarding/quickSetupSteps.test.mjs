import assert from "node:assert/strict";
import test from "node:test";
import { selectQuickSetupSteps, selectReturnMethodsOffered } from "./quickSetupSteps.js";

test("the way back is never asked about when playback never leaves", () => {
  // "Nuvio's own player" hands the stream to nobody, so there is nothing to
  // come back from. Asking anyway spends the one thing this flow has: the
  // person's attention, on a question with no answer that helps them.
  assert.deepEqual(selectQuickSetupSteps({ callbackMode: "none" }), ["player", "offlineSync"]);
  assert.deepEqual(
    selectQuickSetupSteps({
      callbackMode: "none",
      pushState: "not-enabled",
      automationAvailability: "available"
    }),
    ["player", "offlineSync"]
  );
});

test("an external player brings back whichever ways exist on this device", () => {
  // A player that reports progress raises both questions.
  assert.deepEqual(
    selectQuickSetupSteps({
      callbackMode: "progress",
      automaticProgress: true,
      pushState: "not-enabled"
    }),
    ["player", "progress", "return", "offlineSync"]
  );

  // VLC returns but cannot report a position: no progress question, but getting
  // back still matters.
  assert.deepEqual(
    selectQuickSetupSteps({ callbackMode: "return-only", pushState: "not-enabled" }),
    ["player", "return", "offlineSync"]
  );

  // An iPhone with the app installed can offer the Automation even where the
  // relay holds no Push keys at all.
  assert.deepEqual(
    selectQuickSetupSteps({
      callbackMode: "return-only",
      pushState: "server-not-configured",
      automationAvailability: "available"
    }),
    ["player", "return", "offlineSync"]
  );
});

test("the question disappears when neither way back is possible", () => {
  assert.deepEqual(
    selectQuickSetupSteps({
      callbackMode: "return-only",
      pushState: "server-not-configured",
      automationAvailability: "unsupported"
    }),
    ["player", "offlineSync"]
  );
  assert.deepEqual(
    selectQuickSetupSteps({
      callbackMode: "progress",
      automaticProgress: true,
      pushState: "unavailable",
      automationAvailability: "unsupported"
    }),
    ["player", "progress", "offlineSync"]
  );
});

test("which ways back are worth a card", () => {
  // Blocked still earns a card: the browser asks once per origin, so the only
  // useful thing left is saying where to undo it.
  assert.deepEqual(selectReturnMethodsOffered({ pushState: "blocked" }), ["notification"]);
  assert.deepEqual(selectReturnMethodsOffered({ pushState: "enabled" }), ["notification"]);
  assert.deepEqual(selectReturnMethodsOffered({ pushState: "not-enabled" }), ["notification"]);

  // These two are not states the person can act on.
  assert.deepEqual(selectReturnMethodsOffered({ pushState: "unavailable" }), []);
  assert.deepEqual(selectReturnMethodsOffered({ pushState: "server-not-configured" }), []);

  // iOS without the install is still offered: Add to Home Screen is a step the
  // person can take, unlike a relay with no keys.
  assert.deepEqual(selectReturnMethodsOffered({ automationAvailability: "needs-install" }), [
    "automation"
  ]);
  assert.deepEqual(
    selectReturnMethodsOffered({ pushState: "not-enabled", automationAvailability: "available" }),
    ["notification", "automation"]
  );
  assert.deepEqual(selectReturnMethodsOffered({}), []);
});

test("manual reporting rules the notification out, but never the Automation", () => {
  // Manual strips the callbacks out of the launch, so the external player never
  // reports to the relay and the relay has nothing to send a notification
  // about. Offering one would be offering something that cannot fire.
  assert.deepEqual(
    selectReturnMethodsOffered({ pushState: "not-enabled", progressMode: "manual" }),
    []
  );
  assert.deepEqual(
    selectReturnMethodsOffered({ pushState: "enabled", progressMode: "manual" }),
    []
  );

  // The Automation does not depend on a callback at all: iOS fires it when the
  // player closes. It is the one way back that still works under manual, and it
  // lands the person on the prompt that asks where they stopped.
  assert.deepEqual(
    selectReturnMethodsOffered({
      pushState: "enabled",
      automationAvailability: "available",
      progressMode: "manual"
    }),
    ["automation"]
  );

  // Automatic is unchanged.
  assert.deepEqual(
    selectReturnMethodsOffered({ pushState: "not-enabled", progressMode: "automatic" }),
    ["notification"]
  );

  // With manual chosen and no Automation possible, the step has nothing to ask.
  assert.deepEqual(
    selectQuickSetupSteps({
      callbackMode: "progress",
      automaticProgress: true,
      pushState: "enabled",
      automationAvailability: "unsupported",
      progressMode: "manual"
    }),
    ["player", "progress", "offlineSync"]
  );
});
