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
          buildApi.onLoad({ filter: /.*/, namespace: "test" }, (args) => {
            if (args.path === "profile-manager") {
              return { contents: `export const MAX_PROFILES = 5; export const ProfileManager = { getProfiles: async () => [{ id: "1", name: "Primary" }], getActiveProfileId: () => "1" };` };
            }
            if (args.path === "router") {
              return { contents: `export const Router = { getCurrentScreen: () => null, navigate: async () => {}, back: () => {} };` };
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
