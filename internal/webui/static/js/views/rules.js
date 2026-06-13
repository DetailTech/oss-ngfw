// Policy ▸ Rules — the primary daily workspace. Search/filter, create,
// edit, duplicate, insert-after, enable/disable, drag-to-reorder, and
// static shadow detection. Every change auto-stages to the candidate.

import { h, icon, clear } from "../core.js";
import { session } from "../policy.js";
import { pageHead, emptyState, pill, toast, openDrawer, closeDrawer, confirmDialog, searchInput } from "../ui.js";
import * as fmt from "../format.js";

let filter = { q: "", action: "", zone: "" };

export async function render() {
  await session.load();
  const root = h("div", {});
  rerender(root);
  return root;
}

function rerender(root) {
  clear(root);
  const rules = session.draft.rules || [];
  const zones = (session.draft.zones || []).map((z) => z.name);

  root.appendChild(pageHead("Security rules",
    `${rules.filter((r) => !r.disabled).length} active · ${rules.length} total · evaluated top-to-bottom, first match wins`,
    h("button", { class: "btn primary", onclick: () => openRuleEditor(null) }, h("span", { html: icon("plus", 16) }), "Add rule")));

  // toolbar
  const { el: search } = searchInput("Search name, zone, address, service…", (v) => { filter.q = v.toLowerCase(); paint(); });
  const actionSel = h("select", { style: { maxWidth: "150px" }, onchange: (e) => { filter.action = e.target.value; paint(); } },
    opt("", "All actions"), opt("ACTION_ALLOW", "Allow"), opt("ACTION_DENY", "Deny"), opt("ACTION_REJECT", "Reject"));
  const zoneSel = h("select", { style: { maxWidth: "150px" }, onchange: (e) => { filter.zone = e.target.value; paint(); } },
    opt("", "All zones"), ...zones.map((z) => opt(z, z)));
  actionSel.value = filter.action; zoneSel.value = filter.zone;
  root.appendChild(h("div", { class: "toolbar" }, search,
    h("span", { class: "flex", style: { gap: "8px" } }, h("span", { class: "muted", html: icon("filter", 16) }), actionSel, zoneSel)));

  const tableWrap = h("div", { class: "table-wrap" });
  root.appendChild(tableWrap);

  function paint() { renderTable(tableWrap, root); }
  paint();
}

function opt(v, l) { return h("option", { value: v }, l); }

function matchFilter(r) {
  if (filter.action && r.action !== filter.action) return false;
  if (filter.zone && !(r.fromZones || []).includes(filter.zone) && !(r.toZones || []).includes(filter.zone)) return false;
  if (filter.q) {
    const hay = [r.name, r.description, ...(r.fromZones || []), ...(r.toZones || []),
      ...(r.sourceAddresses || []), ...(r.destinationAddresses || []), ...(r.services || [])].join(" ").toLowerCase();
    if (!hay.includes(filter.q)) return false;
  }
  return true;
}

function renderTable(wrap, root) {
  clear(wrap);
  const rules = session.draft.rules || [];
  if (!rules.length) {
    wrap.appendChild(emptyState("rules", "No rules yet", "Add your first rule. Rules are evaluated top-to-bottom; the first match wins.",
      h("button", { class: "btn primary", onclick: () => openRuleEditor(null) }, h("span", { html: icon("plus", 16) }), "Add rule")));
    return;
  }
  const shadowOf = computeShadows(rules);
  const head = h("tr", {},
    h("th", { style: { width: "34px" } }, "#"),
    h("th", { style: { width: "44px" } }, "On"),
    h("th", {}, "Name"),
    h("th", {}, "From → To"),
    h("th", {}, "Source"),
    h("th", {}, "Destination"),
    h("th", {}, "Service"),
    h("th", {}, "Action"),
    h("th", { style: { width: "120px", textAlign: "right" } }, ""));
  const body = h("tbody", {});
  rules.forEach((r, idx) => {
    if (!matchFilter(r)) return;
    body.appendChild(ruleRow(r, idx, shadowOf[idx], root));
  });
  wrap.appendChild(h("table", {}, h("thead", {}, head), body));
  enableDnD(body, root);
}

function ruleRow(r, idx, shadowedBy, root) {
  const act = fmt.ruleAction(r.action);
  const tr = h("tr", { class: r.disabled ? "row-disabled clickable" : "clickable", draggable: "true", dataset: { idx } },
    h("td", { class: "drag-handle", title: "Drag to reorder", html: icon("rules", 14) }),
    h("td", {}, toggle(!r.disabled, async (on) => {
      try { await session.apply((d) => { d.rules[idx].disabled = !on; }); rerender(root); }
      catch (e) { toast("Could not stage change", e.message, "bad"); }
    })),
    h("td", { onclick: () => openRuleEditor(idx) },
      h("div", { class: "flex", style: { gap: "6px" } }, h("strong", {}, r.name || h("span", { class: "muted" }, "(unnamed)")),
        r.log ? h("span", { class: "muted", title: "Logging enabled", html: icon("inbox", 13) }) : null,
        shadowedBy != null ? pill("shadowed", "warn") : null),
      r.description ? h("div", { class: "note", style: { maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.description) : null),
    h("td", { onclick: () => openRuleEditor(idx) },
      h("span", { class: "flex", style: { gap: "5px" } },
        zoneList(r.fromZones), h("span", { class: "muted", html: icon("arrowRight", 13) }), zoneList(r.toZones))),
    h("td", { onclick: () => openRuleEditor(idx) }, refList(r.sourceAddresses)),
    h("td", { onclick: () => openRuleEditor(idx) }, refList(r.destinationAddresses)),
    h("td", { onclick: () => openRuleEditor(idx) }, refList(r.services)),
    h("td", { onclick: () => openRuleEditor(idx) }, pill(act.label, act.cls, true)),
    h("td", { style: { textAlign: "right" } }, rowMenu(r, idx, root)));
  if (shadowedBy != null) tr.title = `Never matches: fully covered by rule #${shadowedBy + 1} above`;
  return tr;
}

function rowMenu(r, idx, root) {
  const btn = (ico, title, fn) => h("button", { class: "icon-btn", title, onclick: (e) => { e.stopPropagation(); fn(); }, html: icon(ico, 16) });
  return h("div", { class: "flex", style: { justifyContent: "flex-end", gap: "2px" } },
    btn("edit", "Edit", () => openRuleEditor(idx)),
    btn("copy", "Duplicate", async () => {
      try { await session.apply((d) => { const c = structuredClone(d.rules[idx]); c.name = uniqueName(d.rules, (c.name || "rule") + "-copy"); d.rules.splice(idx + 1, 0, c); }); rerender(root); toast("Rule duplicated", "Staged to candidate.", "ok"); }
      catch (e) { toast("Failed", e.message, "bad"); }
    }),
    btn("plus", "Insert rule below", () => openRuleEditor(null, idx + 1)),
    btn("trash", "Delete", async () => {
      if (!(await confirmDialog({ title: "Delete rule?", message: `Delete "${r.name || "this rule"}"? This stages to the candidate; nothing changes on the firewall until you commit.`, confirmLabel: "Delete", danger: true }))) return;
      try { await session.apply((d) => d.rules.splice(idx, 1)); rerender(root); toast("Rule deleted", "Staged to candidate.", "ok"); }
      catch (e) { toast("Failed", e.message, "bad"); }
    }));
}

function zoneList(arr) {
  return h("span", {}, (fmt.namesOrAny(arr)).map((z) => h("span", { class: "tag" }, z)));
}
function refList(arr) {
  const items = fmt.namesOrAny(arr);
  return h("span", {}, items.slice(0, 3).map((x) => h("span", { class: "tag" }, x)),
    items.length > 3 ? h("span", { class: "muted" }, ` +${items.length - 3}`) : null);
}

function toggle(checked, onChange) {
  const input = h("input", { type: "checkbox", onclick: (e) => e.stopPropagation(), onchange: (e) => onChange(e.target.checked) });
  input.checked = checked;
  return h("label", { class: "switch", onclick: (e) => e.stopPropagation() }, input, h("span", { class: "slider" }));
}

// ---------- Shadow analysis ----------
function computeShadows(rules) {
  const out = new Array(rules.length).fill(null);
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].disabled) continue;
    for (let j = 0; j < i; j++) {
      if (rules[j].disabled) continue;
      if (covers(rules[j], rules[i])) { out[i] = j; break; }
    }
  }
  return out;
}
function coversDim(a, b) {
  const aAny = !a || a.length === 0 || a.includes("any");
  if (aAny) return true;
  const bAny = !b || b.length === 0 || b.includes("any");
  if (bAny) return false;
  return b.every((x) => a.includes(x));
}
function covers(a, b) {
  return coversDim(a.fromZones, b.fromZones) && coversDim(a.toZones, b.toZones) &&
    coversDim(a.sourceAddresses, b.sourceAddresses) && coversDim(a.destinationAddresses, b.destinationAddresses) &&
    coversDim(a.services, b.services);
}

function uniqueName(rules, base) {
  const names = new Set(rules.map((r) => r.name));
  if (!names.has(base)) return base;
  let i = 2; while (names.has(base + "-" + i)) i++; return base + "-" + i;
}

// ---------- Drag & drop reorder ----------
function enableDnD(tbody, root) {
  let from = null;
  tbody.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("dragstart", (e) => { from = Number(tr.dataset.idx); tr.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    tr.addEventListener("dragend", () => { tr.classList.remove("dragging"); tbody.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target")); });
    tr.addEventListener("dragover", (e) => { e.preventDefault(); tbody.querySelectorAll(".drop-target").forEach((x) => x.classList.remove("drop-target")); tr.classList.add("drop-target"); });
    tr.addEventListener("drop", async (e) => {
      e.preventDefault();
      const to = Number(tr.dataset.idx);
      if (from == null || from === to) return;
      try {
        await session.apply((d) => { const [m] = d.rules.splice(from, 1); d.rules.splice(to, 0, m); });
        rerender(root);
      } catch (err) { toast("Reorder failed", err.message, "bad"); }
    });
  });
}

// ---------- Rule editor (also used by Threats/Traffic pivots) ----------
export function openRuleEditor(idx, insertAt) {
  const editing = idx != null;
  const base = editing ? structuredClone(session.draft.rules[idx])
    : { name: "", fromZones: [], toZones: [], sourceAddresses: [], destinationAddresses: [], services: [], action: "ACTION_ALLOW", log: false, disabled: false, description: "" };
  buildEditor(base, editing, idx, insertAt);
}

// Open the editor for a fully-prefilled new rule (used by Threats/Traffic
// pivots). insertAt places the new rule at a specific index.
export function openRuleEditorPrefilled(rule, insertAt) {
  buildEditor(rule, false, null, insertAt);
}

function buildEditor(rule, editing, idx, insertAt) {
  const zoneOpts = (session.draft.zones || []).map((z) => z.name);
  const addrOpts = (session.draft.addresses || []).map((a) => a.name);
  const svcOpts = (session.draft.services || []).map((s) => s.name);

  const nameInput = h("input", { class: "input", value: rule.name || "", placeholder: "e.g. allow-lan-to-wan", oninput: (e) => (rule.name = e.target.value.trim()) });
  const actionSel = h("select", {}, opt("ACTION_ALLOW", "Allow"), opt("ACTION_DENY", "Deny (drop)"), opt("ACTION_REJECT", "Reject (RST/ICMP)"));
  actionSel.value = rule.action; actionSel.onchange = (e) => (rule.action = e.target.value);
  const descInput = h("textarea", { class: "input", placeholder: "Why this rule exists (recommended for change tracking)", oninput: (e) => (rule.description = e.target.value) }, rule.description || "");
  const logT = toggleField(rule.log, (v) => (rule.log = v));
  const disT = toggleField(rule.disabled, (v) => (rule.disabled = v));

  const body = h("div", {},
    field("Name", nameInput),
    h("div", { class: "grid cols-2" },
      field("From zones", tokenEditor(rule.fromZones, zoneOpts, { any: true })),
      field("To zones", tokenEditor(rule.toZones, zoneOpts, { any: true }))),
    h("div", { class: "grid cols-2" },
      field("Source addresses", tokenEditor(rule.sourceAddresses, addrOpts, { any: true, create: "address" })),
      field("Destination addresses", tokenEditor(rule.destinationAddresses, addrOpts, { any: true, create: "address" }))),
    field("Services", tokenEditor(rule.services, svcOpts, { any: true, create: "service" })),
    field("Action", actionSel),
    h("div", { class: "grid cols-2" },
      field("Log matches", logT, "Record matching connections."),
      field("Disabled", disT, "Keep the rule but stop enforcing it.")),
    field("Description", descInput));

  openDrawer({
    title: editing ? "Edit rule" : "New rule",
    subtitle: "Changes stage to the candidate — commit to enforce.",
    width: "620px",
    body,
    footer: [
      h("button", { class: "btn ghost", onclick: closeDrawer }, "Cancel"),
      h("button", { class: "btn primary", onclick: () => save() }, h("span", { html: icon("check", 16) }), editing ? "Save rule" : "Add rule"),
    ],
  });

  async function save() {
    if (!rule.name) { toast("Name required", "Give the rule a name.", "warn"); return; }
    try {
      await session.apply((d) => {
        if (!d.rules) d.rules = [];
        if (editing) d.rules[idx] = rule;
        else if (insertAt != null) d.rules.splice(insertAt, 0, rule);
        else d.rules.push(rule);
      });
      closeDrawer();
      toast(editing ? "Rule saved" : "Rule added", "Staged to candidate.", "ok");
      const root = document.querySelector("#content > div");
      if (location.hash.startsWith("#/rules") && root) rerender(root);
    } catch (e) { toast("Could not stage rule", e.message, "bad"); }
  }
}

function field(label, control, help) {
  return h("label", { class: "field" }, h("span", {}, label, help ? h("span", { class: "help" }, " — " + help) : null), control);
}
function toggleField(checked, onChange) {
  const input = h("input", { type: "checkbox", onchange: (e) => onChange(e.target.checked) });
  input.checked = checked;
  return h("label", { class: "switch" }, input, h("span", { class: "slider" }));
}

// Chips + add menu. `values` is the live array we mutate. opts.any adds
// "any"; opts.create ("address"|"service") enables inline object creation.
function tokenEditor(values, options, opts = {}) {
  const wrap = h("div", { class: "chips", style: { gap: "6px" } });
  function repaint() {
    clear(wrap);
    values.forEach((v, i) => wrap.appendChild(
      h("span", { class: "chip" }, v, h("button", { title: "Remove", onclick: () => { values.splice(i, 1); repaint(); }, html: icon("x", 13) }))));
    const used = new Set(values);
    const avail = options.filter((o) => !used.has(o));
    const sel = h("select", { style: { width: "auto", minWidth: "120px" } },
      h("option", { value: "" }, "+ add…"),
      opts.any && !used.has("any") ? h("option", { value: "any" }, "any") : null,
      ...avail.map((o) => h("option", { value: o }, o)),
      opts.create ? h("option", { value: "__new__" }, `+ new ${opts.create}…`) : null);
    sel.onchange = () => {
      const v = sel.value;
      if (!v) return;
      if (v === "__new__") { newObject(opts.create, (name) => { values.push(name); repaint(); }); sel.value = ""; return; }
      values.push(v); repaint();
    };
    wrap.appendChild(sel);
  }
  repaint();
  return wrap;
}

// Inline object creation, added straight to the draft (staged on rule save).
function newObject(kind, onCreated) {
  if (kind === "address") {
    const name = h("input", { class: "input", placeholder: "name (e.g. web-server)" });
    const cidr = h("input", { class: "input", placeholder: "CIDR (e.g. 10.0.0.5/32)" });
    openDrawer({
      title: "New address object", width: "440px",
      body: h("div", {}, field("Name", name), field("CIDR", cidr)),
      footer: [h("button", { class: "btn ghost", onclick: closeDrawer }, "Cancel"),
        h("button", { class: "btn primary", onclick: () => { const n = name.value.trim(); if (!n || !cidr.value.trim()) return; (session.draft.addresses ||= []).push({ name: n, cidr: cidr.value.trim() }); closeDrawer(); onCreated(n); } }, "Create")],
    });
  } else {
    const name = h("input", { class: "input", placeholder: "name (e.g. https)" });
    const proto = h("select", {}, opt("PROTOCOL_TCP", "TCP"), opt("PROTOCOL_UDP", "UDP"), opt("PROTOCOL_ICMP", "ICMP"), opt("PROTOCOL_ANY", "Any"));
    const ports = h("input", { class: "input", placeholder: "ports (e.g. 443, 8000-8100)" });
    openDrawer({
      title: "New service object", width: "440px",
      body: h("div", {}, field("Name", name), field("Protocol", proto), field("Ports", ports, "comma-separated; ranges with a dash")),
      footer: [h("button", { class: "btn ghost", onclick: closeDrawer }, "Cancel"),
        h("button", { class: "btn primary", onclick: () => { const n = name.value.trim(); if (!n) return; (session.draft.services ||= []).push({ name: n, protocol: proto.value, ports: parsePorts(ports.value) }); closeDrawer(); onCreated(n); } }, "Create")],
    });
  }
}

export function parsePorts(s) {
  return (s || "").split(",").map((x) => x.trim()).filter(Boolean).map((p) => {
    const [a, b] = p.split("-").map((n) => parseInt(n, 10));
    return b ? { start: a, end: b } : { start: a };
  });
}
