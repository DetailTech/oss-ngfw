// Threats — IDS/IPS alerts with severity facets, search, drill-in, and a
// one-click pivot to a block rule (the observe → act loop).

import { h, icon, clear } from "../core.js";
import { api } from "../api.js";
import { session } from "../policy.js";
import { pageHead, emptyState, pill, toast, openDrawer, closeDrawer, searchInput } from "../ui.js";
import * as fmt from "../format.js";
import { openRuleEditorPrefilled } from "./rules.js";

let state = { q: "", sev: 0, action: "" };

export async function render() {
  const data = await api.alerts(500);
  const alerts = data.alerts || [];
  const root = h("div", {});
  paint(root, alerts);
  return root;
}

function paint(root, alerts) {
  clear(root);
  root.appendChild(pageHead("Threats", `${alerts.length} recent IDS/IPS detections`,
    h("button", { class: "btn", onclick: () => location.reload() }, h("span", { html: icon("refresh", 16) }), "Refresh")));

  if (!alerts.length) {
    root.appendChild(emptyState("shield", "No detections", "The inspection engine has not logged any alerts. Enable IDS/IPS in the policy and generate traffic to see detections here."));
    return;
  }

  // Severity facet tiles
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  alerts.forEach((a) => counts[fmt.severity(a.severity).n]++);
  const facet = (n, label) => h("button", {
    class: "card tight", style: { cursor: "pointer", borderColor: state.sev === n ? "var(--accent)" : "var(--border)", textAlign: "left" },
    onclick: () => { state.sev = state.sev === n ? 0 : n; paint(root, alerts); },
  }, h("div", { class: "stat" }, h("span", { class: "stat-label" }, label),
      h("span", { class: "stat-value " + ("sev-" + n) }, String(counts[n]))));
  root.appendChild(h("div", { class: "grid cols-4", style: { marginBottom: "14px" } },
    facet(1, "Critical"), facet(2, "High"), facet(3, "Medium"), facet(4, "Low")));

  const { el: search } = searchInput("Search signature, category, IP…", (v) => { state.q = v.toLowerCase(); repaint(); });
  const actionSel = h("select", { style: { maxWidth: "160px" }, onchange: (e) => { state.action = e.target.value; repaint(); } },
    h("option", { value: "" }, "All outcomes"), h("option", { value: "blocked" }, "Blocked"), h("option", { value: "allowed" }, "Detected only"));
  actionSel.value = state.action;
  root.appendChild(h("div", { class: "toolbar" }, search, actionSel,
    state.sev ? h("button", { class: "btn sm ghost", onclick: () => { state.sev = 0; paint(root, alerts); } }, "Clear severity filter") : null));

  const wrap = h("div", { class: "table-wrap" });
  root.appendChild(wrap);
  function repaint() { renderTable(wrap, alerts); }
  repaint();
}

function filtered(alerts) {
  return alerts.filter((a) => {
    if (state.sev && fmt.severity(a.severity).n !== state.sev) return false;
    if (state.action && a.action !== state.action) return false;
    if (state.q) {
      const hay = [a.signature, a.category, a.srcIp, a.destIp].join(" ").toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  });
}

function renderTable(wrap, alerts) {
  clear(wrap);
  const rows = filtered(alerts);
  if (!rows.length) { wrap.appendChild(emptyState("search", "No matching alerts", "Adjust your filters.")); return; }
  wrap.appendChild(h("table", {},
    h("thead", {}, h("tr", {},
      h("th", { style: { width: "90px" } }, "Severity"),
      h("th", {}, "Signature"),
      h("th", {}, "Source"),
      h("th", {}, "Destination"),
      h("th", {}, "Outcome"),
      h("th", { style: { textAlign: "right" } }, "Time"))),
    h("tbody", {}, rows.slice(0, 300).map((a) => {
      const s = fmt.severity(a.severity), act = fmt.alertAction(a.action);
      return h("tr", { class: "clickable", onclick: () => detail(a) },
        h("td", {}, pill(s.label, s.cls, true)),
        h("td", { style: { maxWidth: "360px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          a.signature || "—", a.category ? h("div", { class: "note" }, a.category) : null),
        h("td", { class: "mono" }, fmt.endpoint(a.srcIp, a.srcPort)),
        h("td", { class: "mono" }, fmt.endpoint(a.destIp, a.destPort)),
        h("td", {}, pill(act.label, act.cls)),
        h("td", { class: "muted", style: { textAlign: "right" }, title: fmt.absTime(a.time) }, fmt.relTime(a.time)));
    }))));
}

function detail(a) {
  const s = fmt.severity(a.severity), act = fmt.alertAction(a.action);
  openDrawer({
    title: "Alert detail",
    subtitle: a.signature,
    width: "560px",
    body: h("div", {},
      h("div", { class: "flex wrap", style: { marginBottom: "16px" } }, pill(s.label, s.cls, true), pill(act.label, act.cls),
        a.protocol ? h("span", { class: "tag" }, a.protocol) : null, a.signatureId ? h("span", { class: "tag" }, "SID " + a.signatureId) : null),
      h("dl", { class: "kv" },
        kv("Signature", a.signature || "—"), kv("Category", a.category || "—"),
        kv("Source", fmt.endpoint(a.srcIp, a.srcPort)), kv("Destination", fmt.endpoint(a.destIp, a.destPort)),
        kv("Protocol", a.protocol || "—"), kv("Time", fmt.absTime(a.time))),
      h("hr", { class: "divider" }),
      h("div", { class: "note", style: { marginBottom: "10px" } }, "Respond to this detection:")),
    footer: [
      h("button", { class: "btn ghost", onclick: closeDrawer }, "Close"),
      h("button", { class: "btn danger", onclick: () => blockSource(a) }, h("span", { html: icon("block", 16) }), "Block this source"),
    ],
  });
}

function kv(k, v) { return [h("dt", {}, k), h("dd", { class: "mono" }, v)]; }

// Pivot: ensure an address object for the source IP exists in the draft,
// then open the rule editor prefilled with a deny rule, inserted at the
// top so the block is evaluated first.
async function blockSource(a) {
  if (!a.srcIp) { toast("No source IP", "This alert has no source address.", "warn"); return; }
  try {
    await session.load();
    const cidr = a.srcIp.includes(":") ? a.srcIp + "/128" : a.srcIp + "/32";
    const existing = (session.draft.addresses || []).find((x) => x.cidr === cidr);
    const name = existing ? existing.name : "threat-" + a.srcIp.replace(/[.:]/g, "-");
    if (!existing) (session.draft.addresses ||= []).push({ name, cidr, description: "Auto-added from threat alert" });
    closeDrawer();
    openRuleEditorPrefilled({
      name: "block-" + a.srcIp.replace(/[.:]/g, "-"),
      fromZones: [], toZones: [], sourceAddresses: [name], destinationAddresses: [], services: [],
      action: "ACTION_DENY", log: true, disabled: false,
      description: ("Block source from IDS alert: " + (a.signature || "")).trim(),
    }, 0);
  } catch (e) { toast("Failed", e.message, "bad"); }
}
