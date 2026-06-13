// Intel — threat-intelligence feed registry. Shows license posture
// (commercial-use compliance is enforced at commit by the server),
// lets operators enable/disable feeds (staged to candidate), and
// triggers an immediate refresh of the blocklist sets.

import { h, icon, clear } from "../core.js";
import { api } from "../api.js";
import { session } from "../policy.js";
import { pageHead, emptyState, pill, toast, card } from "../ui.js";

export async function render() {
  const [feedsR] = await Promise.all([api.feeds(), session.load()]);
  const feeds = feedsR.feeds || [];
  const root = h("div", {});
  paint(root, feeds);
  return root;
}

function draftEnabled(name) {
  const fe = (session.draft.intel?.feeds || []).find((f) => f.name === name);
  return fe ? fe.enabled : null; // null => not declared in draft
}

function paint(root, feeds) {
  clear(root);
  const commercial = !!session.draft.intel?.commercialUse;
  root.appendChild(pageHead("Threat intelligence",
    `${feeds.filter((f) => f.enabled).length} of ${feeds.length} feeds enabled`,
    h("button", { class: "btn", onclick: async () => {
      try { const r = await api.refreshFeeds(); toast("Feeds refreshed", `${r.entries || 0} entries programmed into blocklist sets.`, "ok"); }
      catch (e) { toast("Refresh failed", e.message, "bad"); }
    } }, h("span", { html: icon("refresh", 16) }), "Refresh now")));

  // Commercial-use posture
  root.appendChild(card(h("h2", {}, "Deployment use"),
    h("div", { class: "flex", style: { justifyContent: "space-between" } },
      h("div", {}, h("div", {}, h("strong", {}, "Commercial use"), " ", commercial ? pill("declared", "violet") : pill("not declared", "neutral")),
        h("div", { class: "note" }, "When declared, the registry refuses feeds whose license forbids commercial use. Enforced at commit.")),
      toggleCommercial(commercial, root, feeds))));

  if (!feeds.length) { root.appendChild(emptyState("intel", "No feeds", "No threat-intel feeds are registered.")); return; }

  const wrap = h("div", { class: "table-wrap", style: { marginTop: "16px" } });
  root.appendChild(wrap);
  renderTable(wrap, feeds, commercial, root);
}

function toggleCommercial(on, root, feeds) {
  const input = h("input", { type: "checkbox", onchange: async (e) => {
    try { await session.apply((d) => { (d.intel ||= {}).commercialUse = e.target.checked; }); paint(root, feeds); toast("Updated", "Staged to candidate — commit to apply.", "ok"); }
    catch (err) { toast("Failed", err.message, "bad"); e.target.checked = on; }
  } });
  input.checked = on;
  return h("label", { class: "switch" }, input, h("span", { class: "slider" }));
}

function renderTable(wrap, feeds, commercial, root) {
  clear(wrap);
  wrap.appendChild(h("table", {},
    h("thead", {}, h("tr", {},
      h("th", { style: { width: "60px" } }, "On"), h("th", {}, "Feed"), h("th", {}, "License"),
      h("th", {}, "Commercial"), h("th", {}, "Kind"), h("th", {}, "Status"))),
    h("tbody", {}, feeds.map((f) => {
      const di = draftEnabled(f.name);
      const effective = di == null ? f.enabled : di;
      const pending = di != null && di !== f.enabled;
      const blocked = commercial && !f.allowsCommercialUse && !f.custom;
      return h("tr", { class: f.custom ? "" : "" },
        h("td", {}, f.custom ? h("span", { class: "muted", title: "Custom feeds are managed in the policy" }, "—") : feedToggle(f, effective, blocked, root, feeds)),
        h("td", {}, h("strong", {}, f.name), f.description ? h("div", { class: "note", style: { maxWidth: "360px" } }, f.description) : null,
          f.url ? h("div", { class: "note mono", style: { maxWidth: "360px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, f.url) : null),
        h("td", {}, f.license || "—", f.attribution ? h("div", { class: "note" }, "Attribution required") : null),
        h("td", {}, f.allowsCommercialUse ? pill("allowed", "ok") : pill("non-commercial", "warn")),
        h("td", {}, f.custom ? pill("custom", "violet") : pill("built-in", "neutral")),
        h("td", {}, blocked ? pill("blocked by license", "bad") : pending ? pill(effective ? "enabling" : "disabling", "warn") : effective ? pill("enabled", "ok", true) : pill("disabled", "neutral")));
    }))));
}

function feedToggle(f, enabled, blocked, root, feeds) {
  const input = h("input", { type: "checkbox", disabled: blocked, onchange: async (e) => {
    try {
      await session.apply((d) => {
        d.intel ||= {}; d.intel.feeds ||= [];
        const fe = d.intel.feeds.find((x) => x.name === f.name);
        if (fe) fe.enabled = e.target.checked; else d.intel.feeds.push({ name: f.name, enabled: e.target.checked });
      });
      paint(root, feeds);
      toast("Staged", `Feed "${f.name}" ${e.target.checked ? "enabled" : "disabled"} — commit to apply.`, "ok");
    } catch (err) { toast("Failed", err.message, "bad"); e.target.checked = enabled; }
  } });
  input.checked = enabled;
  return h("label", { class: "switch", title: blocked ? "License forbids commercial use" : "" }, input, h("span", { class: "slider" }));
}
