// Settings — system info, global dataplane settings (editable, staged to
// candidate), theme, and the API token used when auth is enabled.

import { h, icon, clear } from "../core.js";
import { api, getToken, setToken } from "../api.js";
import { session } from "../policy.js";
import { pageHead, card, toast } from "../ui.js";
import { getTheme, setTheme } from "../app.js";

export async function render() {
  const [verR] = await Promise.allSettled([api.version(), session.load()]);
  const ver = verR.status === "fulfilled" ? verR.value : {};
  const root = h("div", {});
  paint(root, ver);
  return root;
}

function paint(root, ver) {
  clear(root);
  root.appendChild(pageHead("Settings", "System, dataplane, appearance, and access."));
  root.appendChild(h("div", { class: "grid cols-2" },
    systemCard(ver),
    appearanceCard(),
    networkCard(root, ver),
    accessCard()));
}

function systemCard(ver) {
  return card(h("h2", {}, "System"),
    h("dl", { class: "kv" },
      h("dt", {}, "Daemon"), h("dd", {}, "controld"),
      h("dt", {}, "Version"), h("dd", { class: "mono" }, ver.version || "—"),
      h("dt", {}, "Commit"), h("dd", { class: "mono" }, ver.commit || "—"),
      h("dt", {}, "Built"), h("dd", { class: "mono" }, ver.buildDate || "—"),
      h("dt", {}, "Running policy"), h("dd", { class: "mono" }, "v" + session.runningVersion)));
}

function appearanceCard() {
  const seg = h("div", { class: "seg" },
    themeBtn("Dark", "dark"), themeBtn("Light", "light"));
  return card(h("h2", {}, "Appearance"),
    h("label", { class: "field" }, h("span", {}, "Theme"), seg));
}
function themeBtn(label, val) {
  return h("button", { class: getTheme() === val ? "active" : "", onclick: (e) => {
    setTheme(val);
    e.target.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === e.target));
  } }, label);
}

function networkCard(root, ver) {
  const n = structuredClone(session.draft.network || {});
  const mtu = h("input", { class: "input", type: "number", min: "0", placeholder: "0 = unmanaged", value: n.mtu || "" });
  const mss = checkbox(!!n.clampMssToPmtu);
  const offload = checkbox(!!n.manageNicOffloads);
  return card(h("h2", {}, "Dataplane (global network)"),
    h("label", { class: "field" }, h("span", {}, "Interface MTU ", h("span", { class: "help" }, "— e.g. 9000 for jumbo frames; 0 leaves MTUs unmanaged")), mtu),
    h("label", { class: "field flex", style: { justifyContent: "space-between" } }, h("span", {}, "Clamp TCP MSS to path MTU ", h("span", { class: "help" }, "— recommended with jumbo frames / VPN")), mss),
    h("label", { class: "field flex", style: { justifyContent: "space-between" } }, h("span", {}, "Manage NIC offloads ", h("span", { class: "help" }, "— disable GRO/LRO/TSO/GSO on IDS interfaces")), offload),
    h("button", { class: "btn primary", onclick: async () => {
      try {
        await session.apply((d) => {
          d.network ||= {};
          const v = parseInt(mtu.value, 10);
          d.network.mtu = isNaN(v) ? 0 : v;
          d.network.clampMssToPmtu = mss.checked;
          d.network.manageNicOffloads = offload.checked;
        });
        toast("Network settings staged", "Commit to apply to the dataplane.", "ok");
      } catch (e) { toast("Failed", e.message, "bad"); }
    } }, h("span", { html: icon("check", 16) }), "Stage network settings"));
}
function checkbox(on) { const i = h("input", { type: "checkbox" }); i.checked = on; const l = h("label", { class: "switch" }, i, h("span", { class: "slider" })); l.checked = on; Object.defineProperty(l, "checked", { get: () => i.checked }); return l; }

function accessCard() {
  const tok = h("input", { class: "input", type: "password", placeholder: "Bearer token (leave blank if auth disabled)", value: getToken() });
  return card(h("h2", {}, "API access"),
    h("p", { class: "note" }, "When controld runs with a users file, every request needs a bearer token. It is stored in this browser only and sent as ", h("span", { class: "mono" }, "Authorization: Bearer …"), "."),
    h("label", { class: "field" }, h("span", {}, "API token"), tok),
    h("div", { class: "flex" },
      h("button", { class: "btn primary", onclick: async () => {
        setToken(tok.value.trim());
        try { await api.version(); toast("Token saved", "Connection verified.", "ok"); }
        catch (e) { toast("Saved, but request failed", e.message, "warn"); }
      } }, "Save token"),
      h("button", { class: "btn ghost", onclick: () => { setToken(""); tok.value = ""; toast("Token cleared", "", "ok"); } }, "Clear")));
}
