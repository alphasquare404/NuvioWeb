import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadProfileSelectionScreen() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./profileSelectionScreen.js", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "profile-selection-browser-mocks",
        setup(buildApi) {
          buildApi.onResolve({ filter: /profileManager\.js$/ }, () => ({
            path: "profile-manager",
            namespace: "test"
          }));
          buildApi.onResolve({ filter: /router\.js$/ }, () => ({
            path: "router",
            namespace: "test"
          }));
          buildApi.onResolve({ filter: /browserProfileAvatarCache\.js$/ }, () => ({
            path: "avatar-cache",
            namespace: "test"
          }));
          buildApi.onResolve({ filter: /profileSyncService\.js$/ }, () => ({
            path: "profile-sync-service",
            namespace: "test"
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "test" }, (args) => {
            if (args.path === "profile-manager") {
              return { contents: `export const MAX_PROFILES = 5; export const ProfileManager = { getProfiles: async () => [{ id: "1", name: "Primary" }], getActiveProfileId: () => "1" };` };
            }
            if (args.path === "router") {
              return { contents: `export const Router = { getCurrentScreen: () => null, navigate: async () => {}, back: () => {} };` };
            }
            if (args.path === "profile-sync-service") {
              return {
                contents:
                  `export const ProfileSyncService = new Proxy({}, { get: (_, key) => globalThis.__profileSyncService?.[key] });`
              };
            }
            return { contents: `export const removeBrowserProfileAvatar = async () => {}; export const resolveBrowserProfileAvatar = async () => "";` };
          });
        }
      }
    ]
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

test("ProfileSelectionScreen mounts in the browser without a Platform global", async () => {
  const { ProfileSelectionScreen } = await loadProfileSelectionScreen();
  const originalDocument = globalThis.document;
  const originalRender = ProfileSelectionScreen.render;
  const originalHydrateAvatars = ProfileSelectionScreen.hydrateBrowserAvatarUrls;
  const originalLoadAvatarCatalog = ProfileSelectionScreen.loadAvatarCatalog;
  const container = { style: { display: "none" } };
  let renders = 0;

  globalThis.document = {
    getElementById(id) {
      return id === "profileSelection" ? container : null;
    }
  };
  delete globalThis.Platform;
  ProfileSelectionScreen.hydrateBrowserAvatarUrls = async () => {};
  ProfileSelectionScreen.loadAvatarCatalog = async () => {};
  ProfileSelectionScreen.render = () => {
    renders += 1;
  };

  try {
    await ProfileSelectionScreen.mount({
      skipInitialProfileSync: true,
      profilePinEnabled: {}
    });
    assert.equal(container.style.display, "block");
    assert.equal(renders, 1);
  } finally {
    ProfileSelectionScreen.render = originalRender;
    ProfileSelectionScreen.hydrateBrowserAvatarUrls = originalHydrateAvatars;
    ProfileSelectionScreen.loadAvatarCatalog = originalLoadAvatarCatalog;
    if (originalDocument) {
      globalThis.document = originalDocument;
    } else {
      delete globalThis.document;
    }
  }
});

function preparePinEntry(screen, type = "unlock") {
  screen.profiles = [{ id: "4", name: "Test", avatarColorHex: "#fff" }];
  screen.pinOverlayState = { type, profileId: "4", currentPin: null };
  screen.pinOverlayRenderState = screen.pinOverlayState;
  screen.pinOverlayPhase = "open";
  screen.pinValue = "";
  screen.pinDraftValue = "";
  screen.pinOverlayError = "";
  screen.isPinOperationInProgress = false;
  screen.render = () => {};
}

test("Profile PIN digit controller preserves leading zeroes and submits the shared string buffer", async () => {
  globalThis.__profileSyncService = {};
  const { ProfileSelectionScreen } = await loadProfileSelectionScreen();
  const originalSubmit = ProfileSelectionScreen.submitCompletedPin;
  const submitted = [];
  preparePinEntry(ProfileSelectionScreen);
  ProfileSelectionScreen.submitCompletedPin = async (pin) => submitted.push(pin);

  try {
    for (const digit of ["0", "1", "2", "3"]) {
      await ProfileSelectionScreen.activatePinKey(digit);
    }
    assert.equal(ProfileSelectionScreen.pinValue, "0123");
    assert.deepEqual(submitted, ["0123"]);
  } finally {
    ProfileSelectionScreen.submitCompletedPin = originalSubmit;
  }
});

test("Profile PIN physical keyboard uses the same string buffer and backspace path as the keypad", async () => {
  globalThis.__profileSyncService = {};
  const { ProfileSelectionScreen } = await loadProfileSelectionScreen();
  const originalSubmit = ProfileSelectionScreen.submitCompletedPin;
  const submitted = [];
  preparePinEntry(ProfileSelectionScreen);
  ProfileSelectionScreen.submitCompletedPin = async (pin) => submitted.push(pin);

  try {
    for (const key of ["0", "1", "2", "3"]) {
      await ProfileSelectionScreen.handlePinOverlayKeyDown({ key, preventDefault() {} });
    }
    assert.equal(ProfileSelectionScreen.pinValue, "0123");
    assert.deepEqual(submitted, ["0123"]);

    ProfileSelectionScreen.pinValue = "012";
    await ProfileSelectionScreen.handlePinOverlayKeyDown({ key: "Backspace", preventDefault() {} });
    assert.equal(ProfileSelectionScreen.pinValue, "01");
  } finally {
    ProfileSelectionScreen.submitCompletedPin = originalSubmit;
  }
});

test("Profile PIN native numeric input feeds the shared string buffer", async () => {
  globalThis.__profileSyncService = {};
  const { ProfileSelectionScreen } = await loadProfileSelectionScreen();
  const originalSubmit = ProfileSelectionScreen.submitCompletedPin;
  const submitted = [];
  preparePinEntry(ProfileSelectionScreen);
  ProfileSelectionScreen.submitCompletedPin = async (pin) => submitted.push(pin);

  try {
    await ProfileSelectionScreen.handleNativePinInput("0123");
    assert.equal(ProfileSelectionScreen.pinValue, "0123");
    assert.deepEqual(submitted, ["0123"]);
  } finally {
    ProfileSelectionScreen.submitCompletedPin = originalSubmit;
  }
});

test("Profile PIN verify and set flows pass the unchanged string PIN to ProfileSyncService", async () => {
  const calls = [];
  globalThis.__profileSyncService = {
    verifyProfilePin: async (...args) => {
      calls.push(["verify", ...args]);
      return { unlocked: true, retryAfterSeconds: 0 };
    },
    setProfilePin: async (...args) => {
      calls.push(["set", ...args]);
      return true;
    }
  };
  const { ProfileSelectionScreen } = await loadProfileSelectionScreen();
  const originalActivateProfile = ProfileSelectionScreen.activateProfile;
  const originalToast = ProfileSelectionScreen.setPinActionMessage;
  const originalClose = ProfileSelectionScreen.closePinOverlay;
  preparePinEntry(ProfileSelectionScreen);
  ProfileSelectionScreen.activateProfile = async () => {};
  ProfileSelectionScreen.setPinActionMessage = () => {};
  ProfileSelectionScreen.closePinOverlay = () => {};

  try {
    await ProfileSelectionScreen.submitCompletedPin("0123");
    assert.deepEqual(calls, [["verify", "4", "0123"]]);

    calls.length = 0;
    preparePinEntry(ProfileSelectionScreen, "set");
    ProfileSelectionScreen.setPinActionMessage = () => {};
    ProfileSelectionScreen.closePinOverlay = () => {};
    await ProfileSelectionScreen.submitCompletedPin("0123");
    assert.deepEqual(calls, [["set", "4", "0123", null]]);
  } finally {
    ProfileSelectionScreen.activateProfile = originalActivateProfile;
    ProfileSelectionScreen.setPinActionMessage = originalToast;
    ProfileSelectionScreen.closePinOverlay = originalClose;
  }
});

test("Profile PIN overlay omits the virtual keypad and uses one native numeric input", async () => {
  globalThis.__profileSyncService = {};
  const { ProfileSelectionScreen } = await loadProfileSelectionScreen();
  preparePinEntry(ProfileSelectionScreen);

  const markup = ProfileSelectionScreen.renderPinOverlay();
  assert.doesNotMatch(markup, /profile-pin-keypad/);
  assert.match(markup, /data-role="native-pin-input"/);
});
