import test from "node:test";
import assert from "node:assert/strict";
import { copyBrowserExternalStreamLink } from "./browserExternalPlayer.js";
import { clientMediaUrlResolver } from "../../core/streams/clientMediaUrlResolver.js";

test("copy reuses a CDN URL already learned by probing", async () => {
  clientMediaUrlResolver.remember("https://copy.test/cached", "https://cdn.test/cached");
  let copied;
  assert.equal(
    await copyBrowserExternalStreamLink({
      mediaUrl: "https://copy.test/cached",
      runtime: {
        navigator: {
          clipboard: {
            writeText: async (text) => {
              copied = text;
            }
          }
        }
      }
    }),
    true
  );
  assert.equal(copied, "https://cdn.test/cached");
});
test("async CDN resolution starts Safari-compatible clipboard writing during the user gesture", async () => {
  let release,
    copied,
    clipboardStarted = false;
  const runtime = {
    ClipboardItem: class {
      constructor(data) {
        this.data = data;
      }
    },
    fetch: (_url, options) => {
      assert.equal(options.method, "HEAD");
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    navigator: {
      clipboard: {
        write: async (items) => {
          clipboardStarted = true;
          const response = new Response(null);
          Object.defineProperty(response, "url", { value: "https://cdn.test/new" });
          release(response);
          copied = await (await items[0].data["text/plain"]).text();
        }
      }
    }
  };
  const result = copyBrowserExternalStreamLink({ runtime, mediaUrl: "https://copy.test/new" });
  assert.equal(clipboardStarted, true, "clipboard API must be invoked before awaiting network");
  assert.equal(await result, true);
  assert.equal(copied, "https://cdn.test/new");
});
test("blocked CORS preserves the original copyable addon URL instead of inventing a CDN link", async () => {
  let copied;
  const mediaUrl = "https://copy.test/blocked";
  assert.equal(
    await copyBrowserExternalStreamLink({
      mediaUrl,
      runtime: {
        fetch: async () => {
          throw new TypeError("CORS");
        },
        navigator: {
          clipboard: {
            writeText: async (text) => {
              copied = text;
            }
          }
        }
      }
    }),
    true
  );
  assert.equal(copied, mediaUrl);
});
