import {
  AUTOPLAY_SOURCE_GROUPS,
  isAutoplaySourceEnabled,
  normalizeAutoplaySourcePriority,
  toggleAutoplaySource
} from "../../../core/streams/autoplaySourcePolicy.js";
import { bindListReorderDrag } from "../../components/listReorderDrag.js";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
const titleKeys = {
  addons: ["autoplay_group_addons", "Add-ons"],
  plugins: ["autoplay_group_plugins", "Plugins"],
  servers: ["autoplay_group_servers", "Media Servers"]
};

export function renderAutoplaySources(sources, settings, t) {
  const priority = normalizeAutoplaySourcePriority(settings.streamAutoPlaySourcePriority);
  const groups = priority.length ? priority : AUTOPLAY_SOURCE_GROUPS;
  return `<p class="autoplay-source-hint">${escape(t("autoplay_source_priority_hint", {}, "Drag groups to set priority. Switch individual sources on or off."))}</p>
  <div class="autoplay-source-groups" data-autoplay-source-groups>${groups
    .map((group) => {
      const title = t(titleKeys[group][0], {}, titleKeys[group][1]);
      const scopedOut =
        (group !== "plugins" && settings.streamAutoPlaySource === "ENABLED_PLUGINS_ONLY") ||
        (group !== "addons" && settings.streamAutoPlaySource === "INSTALLED_ADDONS_ONLY");
      const options = [
        ...new Map(
          sources[group].map((source) => {
            const item = typeof source === "string" ? { id: source, label: source } : source;
            return [item.id, item];
          })
        ).values()
      ];
      return `<section class="autoplay-source-group" data-autoplay-group="${group}">
      <div class="autoplay-source-group-heading">
        <button type="button" class="autoplay-source-handle" data-autoplay-handle
          aria-label="${escape(t("autoplay_source_reorder", { group: title }, "Reorder " + title))}"
          aria-keyshortcuts="ArrowUp ArrowDown"><span class="material-icons" aria-hidden="true">drag_indicator</span></button>
        <strong>${escape(title)}</strong>
      </div>
      ${scopedOut ? `<small>${escape(t("autoplay_source_scope_excluded", {}, "Excluded by Auto-play Source Scope"))}</small>` : ""}
      ${
        options
          .map(({ id, label, unknown }) => {
            const active = isAutoplaySourceEnabled(settings, group, id);
            return `<button class="autoplay-source-switch" type="button" role="switch"
          data-autoplay-source="${escape(id)}" aria-checked="${active}"${unknown ? " disabled" : ""}>
          <span class="autoplay-source-name">${escape(label)}${unknown ? `<small>${escape(t("autoplay_addon_support_unknown", {}, "Stream support unknown"))}</small>` : ""}</span>
          <span aria-hidden="true" class="settings-toggle-pill${active ? " is-checked" : ""}"><span class="settings-toggle-thumb"></span></span>
        </button>`;
          })
          .join("") ||
        `<small>${escape(t("autoplay_source_group_empty", {}, "No sources connected"))}</small>`
      }
    </section>`;
    })
    .join("")}</div>`;
}

export function bindAutoplaySources(slot, { read, save }) {
  const container = slot.querySelector("[data-autoplay-source-groups]");
  if (!container || container.dataset.bound) return;
  container.dataset.bound = "true";
  const rows = () => [...container.querySelectorAll("[data-autoplay-group]")];
  const getOrder = () => rows().map((row) => row.dataset.autoplayGroup);
  let savedOrder = getOrder().join();
  const persistOrder = () => {
    const order = getOrder();
    if (order.join() === savedOrder) return;
    savedOrder = order.join();
    save({ streamAutoPlaySourcePriority: order });
  };
  bindListReorderDrag({
    container,
    handleSelector: "[data-autoplay-handle]",
    itemSelector: "[data-autoplay-group]",
    scrollContainer: container,
    onDrop: persistOrder
  });
  container.addEventListener("keydown", (event) => {
    if (
      !event.target.matches("[data-autoplay-handle]") ||
      !["ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const row = event.target.closest("[data-autoplay-group]");
    const previous = event.key === "ArrowUp";
    const neighbor = previous ? row.previousElementSibling : row.nextElementSibling;
    if (!neighbor) return;
    if (previous) neighbor.before(row);
    else neighbor.after(row);
    event.target.focus();
    persistOrder();
  });
  container.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-autoplay-source]");
    if (!toggle) return;
    const row = toggle.closest("[data-autoplay-group]");
    const group = row.dataset.autoplayGroup;
    const buttons = [...row.querySelectorAll("[data-autoplay-source]:enabled")];
    const settings = read();
    const changed = toggleAutoplaySource(
      settings,
      group,
      toggle.dataset.autoplaySource,
      buttons.map((button) => button.dataset.autoplaySource)
    );
    save(changed);
    for (const button of buttons) {
      const active = isAutoplaySourceEnabled(
        { ...settings, ...changed },
        group,
        button.dataset.autoplaySource
      );
      button.setAttribute("aria-checked", String(active));
      button.querySelector(".settings-toggle-pill").classList.toggle("is-checked", active);
    }
  });
}
