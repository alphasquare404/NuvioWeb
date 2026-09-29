import { Platform } from "../../platform/index.js";

// One definition of "offline" for every screen that has to behave differently
// without a connection. It lived as a private helper inside Home, which meant
// Library could not ask the same question and got a different answer by not
// asking at all.
//
// `navigator.onLine === false` is the only claim worth trusting here: a true
// reading means the device thinks it has a route, which is not the same as the
// internet working, so screens treat the negative as certain and the positive
// as unproven.
export function isBrowserOfflineNow() {
  return Platform.isBrowser() && typeof navigator !== "undefined" && navigator.onLine === false;
}
