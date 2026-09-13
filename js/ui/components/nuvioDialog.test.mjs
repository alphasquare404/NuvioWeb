import assert from "node:assert/strict";
import test from "node:test";
import { NuvioDialog } from "./nuvioDialog.js";

function keyEvent(target, key = "Backspace") {
  return {
    key,
    target,
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}

test("dialog preserves Backspace for an opted-in editable field", () => {
  let dismissed = false;
  const dialog = {
    _destroyed: false,
    _eventKey: () => ({ isBack: true }),
    _dismiss: () => { dismissed = true; }
  };
  const event = keyEvent({ closest: (selector) => selector === "[data-nuvio-dialog-preserve-deletion]" ? {} : null });

  NuvioDialog.prototype._onKey.call(dialog, event);

  assert.equal(dismissed, false);
  assert.equal(event.prevented, false);
  assert.equal(event.stopped, false);
});

test("dialog retains its Backspace dismiss behavior outside opted-in fields", () => {
  let dismissed = false;
  const dialog = {
    _destroyed: false,
    _eventKey: () => ({ isBack: true }),
    _dismiss: () => { dismissed = true; }
  };
  const event = keyEvent({ closest: () => null });

  NuvioDialog.prototype._onKey.call(dialog, event);

  assert.equal(dismissed, true);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
});
