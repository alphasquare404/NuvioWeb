import { ProfileManager } from "../../../core/profile/profileManager.js";
import { mediaCatalogLibraries } from "../../../data/repository/mediaServerCatalogRepository.js";
import {
  MediaConnectionsStore,
  connectMediaServer,
  connectSeerr,
  listSeerrRequests
} from "../../../core/media/mediaConnections.js";

const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );

export function renderMediaConnections(t) {
  const { servers, seerr } = MediaConnectionsStore.get();
  const label = (key, fallback) => escape(t(key, {}, fallback));
  const disconnect = label("media_connection_disconnect", "Disconnect");
  const serverType = label("media_connection_type", "Server type");
  const methodLabel = label("media_seerr_login_method", "Sign-in method");
  const seerrOption = label("media_seerr_sign_in_local", "Sign in with Seerr");
  const jellyfinOption = label("media_seerr_sign_in_jellyfin", "Sign in with Jellyfin");
  const choiceField = (name, title, value, caption) => `
    <div class="media-server-type-field">
      <span>${title}</span>
      <input type="hidden" name="${name}" value="${value}" />
      <button type="button" data-media-type-trigger="${name}" aria-label="${title}: ${caption}" data-media-type-label="${title}" aria-haspopup="dialog">
        <span data-media-type-value>${caption}</span><span class="material-icons" aria-hidden="true">expand_more</span>
      </button>
    </div>`;
  const fields = (kind) => `
    <label>${kind === "seerr" ? label("media_seerr_url", "Seerr URL") : label("media_connection_url", "Server URL")}<input name="url" type="url" required placeholder="https://" /></label>
    <label><span data-media-identity-label>${kind === "seerr" ? label("media_connection_email", "Seerr email") : label("media_connection_username", "Username")}</span><input name="username" autocomplete="username" required /></label>
    <label><span data-media-password-label>${kind === "seerr" ? label("media_seerr_password", "Seerr Password") : label("media_connection_password", "Password")}</span><input name="password" type="password" autocomplete="current-password" /></label>`;
  return `<div class="media-connections" data-media-connections>
    <section>
      <h3>${label("autoplay_group_servers", "Media Servers")}</h3>
      ${servers
        .map(
          (
            server
          ) => `<div class="media-server-card" data-media-server="${escape(server.id)}"><div class="media-connection-row"><strong>${escape(server.name)}</strong><button type="button" data-media-disconnect="${escape(server.id)}">${disconnect}</button></div>
        <details data-media-libraries><summary>${label("media_connection_libraries", "Libraries")}</summary><div data-media-library-options></div><p role="status"></p></details></div>`
        )
        .join("")}
      <details class="settings-manager-add media-add-server"${servers.length ? "" : " open"}>
        <summary class="settings-manager-add-trigger"><span class="material-icons" aria-hidden="true">add</span>${label("media_connection_add_server", "Add server")}</summary>
        <form data-media-login="server" autocomplete="off">
        ${choiceField("kind", serverType, "jellyfin", "Jellyfin")}
        <label>${label("media_connection_name", "Display name")}<input name="name" /></label>
        ${fields("server")}
        <button type="submit">${label("media_connection_sign_in", "Sign in")}</button>
        <p role="status"></p>
        </form>
      </details>
    </section>
    <section>
      <h3>Seerr</h3>
      <div class="media-seerr-notice">
        <span>${label("media_seerr_cors_notice", "Your Seerr reverse proxy may need to allow this site before you can sign in.")}</span>
        <a href="/assets/seerr-cors.md" target="_blank" rel="noopener noreferrer">${label("media_seerr_cors_guide", "Seerr setup guide")}</a>
      </div>
      ${
        seerr
          ? `<div class="media-connection-row"><strong>${escape(seerr.name)}</strong><div class="media-connection-actions"><button type="button" data-seerr-requests>${label("media_connection_my_requests", "My Requests")}</button><button type="button" data-media-disconnect="seerr">${disconnect}</button></div></div>
          <p data-seerr-request-status role="status"></p><ul data-seerr-request-list></ul>`
          : `<form data-media-login="seerr" autocomplete="off">
            ${choiceField("method", methodLabel, "local", seerrOption)}
            ${fields("seerr")}<button type="submit">${label("media_connection_sign_in", "Sign in")}</button><p role="status"></p>
          </form>`
      }
    </section>
    <dialog data-media-type-dialog="kind" aria-label="${serverType}">
      <header><strong>${serverType}</strong></header>
      <button type="button" data-media-type-option="jellyfin" aria-pressed="true">Jellyfin</button>
      <button type="button" data-media-type-option="emby" aria-pressed="false">Emby</button>
    </dialog>
    ${
      seerr
        ? ""
        : `<dialog data-media-type-dialog="method" aria-label="${methodLabel}">
      <header><strong>${methodLabel}</strong></header>
      <button type="button" data-media-type-option="local" aria-pressed="true">${seerrOption}</button>
      <button type="button" data-media-type-option="jellyfin" aria-pressed="false">${jellyfinOption}</button>
    </dialog>`
    }
  </div>`;
}

export function bindMediaConnections(slot, render, t) {
  const panel = slot.querySelector("[data-media-connections]");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";
  const scope = ProfileManager.getActiveProfileId();
  const active = () => scope === ProfileManager.getActiveProfileId();
  const save = (partial) =>
    MediaConnectionsStore.setForProfile(scope, partial, { silentSync: true });
  const seerrForm = panel.querySelector('[data-media-login="seerr"]');
  seerrForm?.elements.method.addEventListener("change", () => {
    const jellyfin = seerrForm.elements.method.value === "jellyfin";
    seerrForm.querySelector("[data-media-identity-label]").textContent = jellyfin
      ? t("media_seerr_jellyfin_username", {}, "Jellyfin username")
      : t("media_connection_email", {}, "Seerr email");
    seerrForm.querySelector("[data-media-password-label]").textContent = jellyfin
      ? t("media_seerr_jellyfin_password", {}, "Jellyfin Password")
      : t("media_seerr_password", {}, "Seerr Password");
    seerrForm.elements.username.value = "";
    seerrForm.elements.password.value = "";
    seerrForm.querySelector("[role=status]").textContent = "";
  });
  for (const typeTrigger of panel.querySelectorAll("[data-media-type-trigger]")) {
    const fieldName = typeTrigger.dataset.mediaTypeTrigger;
    const typeDialog = panel.querySelector(`[data-media-type-dialog="${fieldName}"]`);
    const typeField = typeTrigger.form.elements.namedItem(fieldName);
    const typeOptions = [...typeDialog.querySelectorAll("[data-media-type-option]")];
    typeTrigger.addEventListener("click", () => {
      typeDialog.showModal();
      typeOptions.find((option) => option.dataset.mediaTypeOption === typeField.value)?.focus();
    });
    typeDialog.addEventListener("click", (event) => {
      const option = event.target.closest("[data-media-type-option]");
      if (option) {
        const changed = typeField.value !== option.dataset.mediaTypeOption;
        typeField.value = option.dataset.mediaTypeOption;
        typeTrigger.querySelector("[data-media-type-value]").textContent = option.textContent;
        typeTrigger.setAttribute(
          "aria-label",
          `${typeTrigger.dataset.mediaTypeLabel}: ${option.textContent}`
        );
        for (const button of typeOptions)
          button.setAttribute("aria-pressed", String(button === option));
        if (changed) typeField.dispatchEvent(new Event("change"));
      }
      if (option || event.target === typeDialog) {
        typeDialog.close();
      }
    });
    typeDialog.addEventListener("close", () => typeTrigger.focus());
  }
  for (const details of panel.querySelectorAll("[data-media-libraries]")) {
    details.addEventListener("toggle", async () => {
      if (!details.open || !active()) return;
      const id = details.closest("[data-media-server]").dataset.mediaServer;
      const server = MediaConnectionsStore.getForProfile(scope).servers.find(
        (item) => item.id === id
      );
      if (!server) return;
      const status = details.querySelector("[role=status]");
      const options = details.querySelector("[data-media-library-options]");
      status.textContent = t("media_connection_library_loading", {}, "Loading libraries…");
      options.replaceChildren();
      try {
        const libraries = await mediaCatalogLibraries(server, { refresh: true });
        if (!active() || !details.open) return;
        for (const library of libraries) {
          const control = document.createElement("button");
          control.type = "button";
          control.dataset.mediaLibraryId = library.id;
          control.dataset.mediaLibraryKind = library.kind;
          control.setAttribute("role", "switch");
          const checked =
            !Array.isArray(server.libraryIds) || server.libraryIds.includes(library.id);
          control.setAttribute("aria-checked", String(checked));
          const label = document.createElement("span");
          label.textContent = library.name;
          const track = document.createElement("span");
          track.className = `settings-toggle-pill${checked ? " is-checked" : ""}`;
          track.setAttribute("aria-hidden", "true");
          const thumb = document.createElement("span");
          thumb.className = "settings-toggle-thumb";
          track.append(thumb);
          control.append(label, track);
          options.append(control);
        }
        status.textContent = libraries.length
          ? ""
          : t("media_connection_no_libraries", {}, "No supported libraries.");
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }
  panel.addEventListener("click", (event) => {
    const control = event.target.closest("[data-media-library-id]");
    if (!control || !active()) return;
    const options = control.closest("[data-media-library-options]");
    const id = options.closest("[data-media-server]").dataset.mediaServer;
    const { servers } = MediaConnectionsStore.getForProfile(scope);
    const checked = control.getAttribute("aria-checked") !== "true";
    control.setAttribute("aria-checked", String(checked));
    control.querySelector(".settings-toggle-pill").classList.toggle("is-checked", checked);
    const libraryIds = [...options.querySelectorAll('[aria-checked="true"]')].map(
      (button) => button.dataset.mediaLibraryId
    );
    const libraries = [...options.querySelectorAll("[data-media-library-id]")].map((button) => ({
      id: button.dataset.mediaLibraryId,
      name: button.firstElementChild.textContent,
      kind: button.dataset.mediaLibraryKind,
      selected: button.getAttribute("aria-checked") === "true"
    }));
    save({
      servers: servers.map((server) =>
        server.id === id ? { ...server, libraries, libraryIds } : server
      )
    });
    options.parentElement.querySelector("[role=status]").textContent = t(
      "media_connection_libraries_saved",
      {},
      "Library selection saved."
    );
  });
  panel.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-media-login]");
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector("button[type=submit]");
    if (submit.disabled) return;
    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    const status = form.querySelector("[role=status]");
    status.textContent = t("media_connection_signing_in", {}, "Signing in…");
    const inputs = Object.fromEntries(new FormData(form));
    const methodTrigger = form.querySelector('[data-media-type-trigger="method"]');
    if (methodTrigger) methodTrigger.disabled = true;
    try {
      if (form.dataset.mediaLogin === "seerr") {
        const seerr = await connectSeerr(inputs);
        if (!active()) return;
        save({ seerr });
      } else {
        const server = await connectMediaServer(inputs);
        if (!active()) return;
        const { servers } = MediaConnectionsStore.getForProfile(scope);
        const existing = servers.find(
          (item) =>
            item.id === server.id ||
            (item.kind === server.kind &&
              item.userId === server.userId &&
              (item.url === server.url ||
                (server.remoteServerId && item.remoteServerId === server.remoteServerId)))
        );
        save({
          servers: [
            ...servers.filter((item) => item.id !== existing?.id),
            {
              ...existing,
              ...server,
              id: existing?.id || server.id,
              remoteServerId: server.remoteServerId || existing?.remoteServerId || ""
            }
          ]
        });
      }
      form.reset();
      await render();
    } catch (error) {
      if (form.dataset.mediaLogin === "seerr" && error.status === 403) {
        status.textContent =
          inputs.method === "jellyfin"
            ? t(
                "media_seerr_jellyfin_forbidden",
                {},
                "Seerr refused the Jellyfin sign-in. Try the same Jellyfin account on the Seerr website."
              )
            : t(
                "media_seerr_sign_in_forbidden",
                {},
                "Seerr refused sign-in. Try the same email and Seerr password on the Seerr website."
              );
      } else {
        status.textContent =
          error instanceof TypeError
            ? t("media_connection_unreachable", {}, "Could not reach this server from the browser.")
            : error.message;
      }
    } finally {
      if (methodTrigger) methodTrigger.disabled = false;
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
    }
  });
  panel.addEventListener("click", async (event) => {
    const remove = event.target.closest("[data-media-disconnect]");
    if (!active()) return;
    const { seerr, servers } = MediaConnectionsStore.getForProfile(scope);
    if (remove) {
      const id = remove.dataset.mediaDisconnect;
      save(
        id === "seerr" ? { seerr: null } : { servers: servers.filter((item) => item.id !== id) }
      );
      await render();
      return;
    }
    const requests = event.target.closest("[data-seerr-requests]");
    if (!requests || requests.disabled || !seerr) return;
    const status = panel.querySelector("[data-seerr-request-status]");
    const list = panel.querySelector("[data-seerr-request-list]");
    requests.disabled = true;
    requests.setAttribute("aria-busy", "true");
    status.textContent = t("media_connection_loading", {}, "Loading requests…");
    list.replaceChildren();
    try {
      const rows = await listSeerrRequests(seerr);
      if (!active()) return;
      status.textContent = rows.length
        ? ""
        : t("media_connection_no_requests", {}, "No requests yet.");
      for (const row of rows) {
        const item = document.createElement("li");
        item.textContent = row.title || t("media_seerr_title_unavailable", {}, "Title unavailable");
        list.append(item);
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      requests.disabled = false;
      requests.removeAttribute("aria-busy");
    }
  });
}
