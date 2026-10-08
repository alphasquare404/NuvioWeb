import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

// Why this file is linted from a test rather than from `npm run lint`.
//
// `currentSourceCandidate` was referenced four times in the video error handler
// and never declared anywhere. It shipped, and it stayed, because of three
// things lining up: `npm run lint` covers only js/ui/screens/home, playerScreen
// cannot be imported by a unit test (the router statically imports every screen
// and every screen imports the router), and the handler is `async`, so the
// ReferenceError became an unhandled rejection instead of a visible failure.
// Every playback failure stopped at that line -- no startup error, no sources
// error, no offer to pick another source -- and said nothing.
//
// A test asserting the fixed line would only guard that line. `no-undef` over
// the whole file guards the class, which matters most here: 17k lines, the
// thickest `this`-state in the codebase, and nothing else checking it.
//
// Only `no-undef` is asserted. The file still carries unused-variable debt, and
// failing this test for that would make it a lint ratchet nobody asked for.
//
// It costs ~2.4s, most of the suite's growth, because eslint parses 17k lines.
// Delete it the day `npm run lint` covers this file: the guard is the point, not
// the venue.
test("no identifier in playerScreen.js is used without being declared", async () => {
  const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
  const eslint = new ESLint({ cwd });
  const [result] = await eslint.lintFiles(["js/ui/screens/player/playerScreen.js"]);

  const undeclared = result.messages
    .filter((message) => message.ruleId === "no-undef")
    .map((message) => `${message.line}:${message.column} ${message.message}`);

  assert.deepEqual(undeclared, [], "each of these throws the moment its branch runs");
});
