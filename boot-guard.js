(function installNuvioBootGuard(window, document) {
  "use strict";

  if (window.NuvioBootGuard) return;

  var OVERLAY_ID = "nuvio-boot-error";
  var active = true;
  var lastStage = "Loading startup files";

  function text(value) {
    return value === undefined || value === null || value === "" ? "Unavailable" : String(value);
  }

  function removeOverlay() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function showError(message, details, code) {
    if (!active || !document.body) return;
    removeOverlay();

    var overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");
    overlay.style.cssText =
      "position:fixed;z-index:2147483647;inset:0;box-sizing:border-box;background:#0d0d0d;" +
      "color:#f5f5f5;font-family:Arial,sans-serif;display:flex;align-items:center;" +
      "justify-content:center;padding:32px;";

    var card = document.createElement("div");
    card.style.cssText = "width:100%;max-width:760px;text-align:center;";
    var title = document.createElement("div");
    title.style.cssText = "font-size:clamp(28px,5vw,44px);line-height:1.15;font-weight:700;margin-bottom:22px;";
    title.textContent = "Nuvio could not start";
    var description = document.createElement("div");
    description.style.cssText = "font-size:18px;line-height:1.45;color:#c9c9c9;margin:0 auto 24px;";
    description.textContent = text(message);
    var diagnostic = document.createElement("div");
    diagnostic.style.cssText =
      "box-sizing:border-box;text-align:left;white-space:pre-wrap;word-break:break-word;" +
      "font-family:monospace;font-size:14px;line-height:1.45;color:#ddd;background:#181818;" +
      "border:1px solid #343434;border-radius:14px;padding:18px;margin:0 auto 24px;";
    diagnostic.textContent = "Code: " + text(code || "BOOT-ERROR") + "\nStage: " + text(lastStage) + "\nDetails: " + text(details);
    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.style.cssText = "min-width:140px;padding:12px 24px;border:0;border-radius:10px;background:#fff;color:#111;font-size:16px;font-weight:700;";
    retry.onclick = function retryBoot() { window.location.reload(); };

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(diagnostic);
    card.appendChild(retry);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    try { retry.focus(); } catch (ignored) {}
  }

  function formatRuntimeError(message, source, line, column, error) {
    var parts = [];
    var errorText = error && (error.stack || error.message);
    if (errorText) parts.push(String(errorText));
    else if (message) parts.push(String(message));
    if (source) parts.push(String(source) + ":" + Number(line || 0) + ":" + Number(column || 0));
    return parts.join("\n");
  }

  window.NuvioBootGuard = {
    stage: function stage(name) { if (active && name) lastStage = String(name); },
    fail: function fail(message, details, code) { showError(message, details, code); },
    scriptFailed: function scriptFailed(source) { showError("A required startup file could not be loaded.", text(source), "BOOT-ASSET"); },
    ready: function ready() { active = false; removeOverlay(); },
    loadScript: function loadScript(source) {
      var script = document.createElement("script");
      script.async = false;
      script.defer = false;
      script.src = source;
      script.onerror = function handleStartupScriptError() { window.NuvioBootGuard.scriptFailed(source); };
      window.NuvioBootGuard.stage("Loading " + source);
      document.body.appendChild(script);
    },
    isActive: function isActive() { return active; }
  };

  var previousOnError = window.onerror;
  window.onerror = function onBootError(message, source, line, column, error) {
    if (active) showError("Something went wrong while the application was starting.", formatRuntimeError(message, source, line, column, error), "BOOT-RUNTIME");
    return typeof previousOnError === "function" ? previousOnError.apply(window, arguments) : false;
  };

  window.addEventListener?.("unhandledrejection", function onBootRejection(event) {
    var reason = event && event.reason;
    if (active) showError("Something went wrong while the application was starting.", reason && (reason.stack || reason.message) ? reason.stack || reason.message : reason, "BOOT-PROMISE");
  });
})(window, document);
