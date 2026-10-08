import assert from "node:assert/strict";
import test from "node:test";
import {
  copyAutomationShortcutTarget,
  getAutomationReturnAvailability,
  getAutomationShortcutTarget,
  hasPublishedAutomationShortcut,
  isAutomationReturnSupported,
  openAutomationShortcut,
  renderAutomationReturnGuide
} from "./browserAutomationReturn.js";

test("the Automation is offered only where its Shortcut could be built", () => {
  // The Shortcut opens an app that is on the Home Screen, so offering it in a
  // browser tab would be offering something that cannot be made to work.
  assert.equal(isAutomationReturnSupported({ platform: "ios", installed: true }), true);
  assert.equal(isAutomationReturnSupported({ platform: "ios", installed: false }), false);
  assert.equal(isAutomationReturnSupported({ platform: "android", installed: true }), false);
  assert.equal(isAutomationReturnSupported({ platform: "other", installed: true }), false);
  assert.equal(isAutomationReturnSupported({}), false);

  // iOS without the install is a separate answer from "not possible here": one
  // is a step the person can go and take, the other is silence.
  assert.equal(getAutomationReturnAvailability({ platform: "ios", installed: true }), "available");
  assert.equal(
    getAutomationReturnAvailability({ platform: "ios", installed: false }),
    "needs-install"
  );
  assert.equal(
    getAutomationReturnAvailability({ platform: "android", installed: true }),
    "unsupported"
  );
});

test("the address the Shortcut opens is read off the page, never written down", () => {
  // A Shortcut carries the host it opens, so every self-hosted deployment needs
  // a different one. The page is the only thing that knows which host this is.
  assert.equal(
    getAutomationShortcutTarget({ location: { host: "nuvio.example.com" } }),
    "webapp://nuvio.example.com/"
  );
  assert.equal(
    getAutomationShortcutTarget({ location: { host: "localhost:4174" } }),
    "webapp://localhost:4174/"
  );
  // No host is no address: an empty "webapp:///" would be a broken Shortcut
  // presented as a working one.
  assert.equal(getAutomationShortcutTarget({ location: { host: "" } }), "");
  assert.equal(getAutomationShortcutTarget({}), "");
});

test("the first step asks for the Shortcut whichever way this deployment can give it", () => {
  const guide = renderAutomationReturnGuide({
    availability: "available",
    shortcutTarget: "webapp://nuvio.example.com/"
  });
  const items = guide.match(/<li>[\s\S]*?<\/li>/g) || [];
  assert.equal(items.length, 5, "five numbered steps");

  // Whichever path this build took, step one is where the Shortcut is got, and
  // no later step repeats it.
  const firstStep = items[0];
  if (hasPublishedAutomationShortcut()) {
    assert.match(firstStep, /data-action="addReturnShortcut"/);
    assert.doesNotMatch(guide, /data-action="copyReturnShortcutTarget"/);
  } else {
    assert.match(firstStep, /data-action="copyReturnShortcutTarget"/);
    assert.match(firstStep, /webapp:\/\//, "the address to paste is shown, not just described");
    assert.doesNotMatch(guide, /data-action="addReturnShortcut"/);
  }
  for (const later of items.slice(1)) {
    assert.doesNotMatch(later, /addReturnShortcut|copyReturnShortcutTarget/);
  }
});

test("the tutorial plays where it is, under the steps and centred", () => {
  const guide = renderAutomationReturnGuide({ availability: "available" });

  const stepsEnd = guide.indexOf("</ol>");
  const caption = guide.indexOf("automation-return-tutorial-caption");
  const frame = guide.indexOf("<iframe");
  assert.ok(stepsEnd > -1 && caption > stepsEnd, "caption follows the steps");
  assert.ok(frame > caption, "the frame follows its caption");

  assert.match(guide, /youtube-nocookie\.com\/embed\/m_1-JQSLo58/);
  assert.match(guide, /playsinline=1/);
  // No lazy loading: the frame sits below the fold inside a scrolling step,
  // and a deferred load that never triggers leaves a black rectangle where the
  // whole point of the step should be.
  assert.doesNotMatch(guide, /loading="lazy"/);
  // A frame that will not load must not be a dead end.
  assert.match(guide, /data-action="openReturnTutorial"/);
});

test("the guide says nothing at all where it cannot be done", () => {
  const needsInstall = renderAutomationReturnGuide({ availability: "needs-install" });
  assert.match(needsInstall, /Add to Home Screen/);
  assert.doesNotMatch(needsInstall, /addReturnShortcut|copyReturnShortcutTarget/);
  assert.doesNotMatch(needsInstall, /<iframe/);

  assert.equal(renderAutomationReturnGuide({ availability: "unsupported" }), "");

  // messageHtml is injected into the Settings dialog with no wrapper of its
  // own, so every branch brings one or the dialog has nothing to scroll.
  for (const availability of ["available", "needs-install"]) {
    assert.match(
      renderAutomationReturnGuide({ availability }),
      /class="automation-return-guide"/,
      `${availability} must carry its own wrapper`
    );
  }
});

test("a deployment that published no Shortcut never opens someone else's", () => {
  const calls = [];
  const runtime = {
    open(url, target, features) {
      calls.push([url, target, features]);
    }
  };
  openAutomationShortcut(runtime);

  if (hasPublishedAutomationShortcut()) {
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], "_blank");
    assert.equal(calls[0][2], "noopener");
  } else {
    // The hard rule: with nothing configured there is nothing to open. A
    // fallback link here would send this deployment's users to another
    // deployment's instance.
    assert.deepEqual(calls, []);
  }

  // A runtime with no opener must not throw: this renders inside a dialog that
  // has no business taking the screen down with it.
  assert.doesNotThrow(() => openAutomationShortcut({}));
});

test("copying the address survives a clipboard that refuses", async () => {
  const written = [];
  const ok = await copyAutomationShortcutTarget({
    location: { host: "nuvio.example.com" },
    navigator: {
      clipboard: {
        async writeText(value) {
          written.push(value);
        }
      }
    }
  });
  assert.equal(ok, true);
  assert.deepEqual(written, ["webapp://nuvio.example.com/"]);

  const refused = await copyAutomationShortcutTarget({
    location: { host: "nuvio.example.com" },
    navigator: {
      clipboard: {
        async writeText() {
          throw new Error("denied");
        }
      }
    }
  });
  assert.equal(refused, false, "a refusal is reported, not thrown");

  assert.equal(await copyAutomationShortcutTarget({ location: { host: "x" } }), false);
  assert.equal(await copyAutomationShortcutTarget({ location: { host: "" } }), false);
});
