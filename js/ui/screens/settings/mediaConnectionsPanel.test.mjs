import assert from "node:assert/strict";
import test from "node:test";
import { renderMediaConnections } from "./mediaConnectionsPanel.js";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};

const t = (key, _params, fallback) => fallback ?? key;

function renderWithSeerr() {
  storage.clear();
  storage.set(
    "mediaConnections",
    JSON.stringify({
      __profileScoped: true,
      version: 1,
      profiles: {
        1: {
          servers: [],
          seerr: { name: "My Seerr", url: "https://seerr.test", userId: "7", token: "secret" }
        }
      }
    })
  );
  return renderMediaConnections(t);
}

test("Add Server reuses the + Add Addon trigger style", () => {
  const html = renderWithSeerr();
  assert.match(html, /<details class="settings-manager-add media-add-server"/);
  assert.match(
    html,
    /<summary class="settings-manager-add-trigger"><span class="material-icons" aria-hidden="true">add<\/span>Add server<\/summary>/
  );
  assert.doesNotMatch(html, /<summary><span class="material-icons"/);
});

test("Seerr actions keep My Requests beside Disconnect", () => {
  const html = renderWithSeerr();
  const actions = html.match(/<div class="media-connection-actions">[\s\S]*?<\/div>/);
  assert.ok(actions, "the Seerr row has an actions group");
  assert.match(actions[0], /data-seerr-requests>My Requests<\/button>/);
  assert.match(actions[0], /data-media-disconnect="seerr">Disconnect<\/button>/);
  assert.equal(html.split("data-seerr-requests").length - 1, 1);
  assert.ok(
    html.indexOf("data-seerr-requests") < html.indexOf('data-media-disconnect="seerr"'),
    "My Requests sits to the left of Disconnect"
  );
});
