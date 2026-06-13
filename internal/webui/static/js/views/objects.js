// Policy ▸ Objects — zones, addresses, and services. Reusable building
// blocks referenced by rules. All edits stage to the candidate.

import { h, icon, clear } from "../core.js";
import { session } from "../policy.js";
import { pageHead, emptyState, toast, openDrawer, closeDrawer, confirmDialog } from "../ui.js";
import * as fmt from "../format.js";
import { parsePorts } from "./rules.js";

let tab = "addresses";

export async function render(ctx) {
  await session.load();
  if (ctx.query.tab) tab = ctx.query.tab;
  const root = h("div", {});
  paint(root);
  return root;
}

function paint(root) {
  clear(root);
  root.appendChild(pageHead("Objects", "Named zones, addresses, and services reused across rules.",
    h("button", { class: "btn primary", onclick: () => editObject(tab, null, root) }, h("span", { html: icon("plus", 16) }), "New " + singular(tab))));

  const seg = h("div", { class: "seg" },
    segBtn("Addresses", "addresses", root), segBtn("Services", "services", root), segBtn("Zones", "zones", root));
  root.appendChild(h("div", { class: "toolbar" }, seg));

  const wrap = h("div", { class: "table-wrap" });
  root.appendChild(wrap);
  ({ addresses: addrTable, services: svcTable, zones: zoneTable })[tab](wrap, root);
}

function segBtn(label, key, root) {
  const n = (session.draft[key] || []).length;
  return h("button", { class: tab === key ? "active" : "", onclick: () => { tab = key; paint(root); } }, `${label} (${n})`);
}
function singular(t) { return { addresses: "address", services: "service", zones: "zone" }[t]; }

function rowActions(kind, idx, root, name) {
  return h("div", { class: "flex", style: { justifyContent: "flex-end", gap: "2px" } },
    h("button", { class: "icon-btn", title: "Edit", onclick: () => editObject(kind, idx, root), html: icon("edit", 16) }),
    h("button", { class: "icon-btn", title: "Delete", onclick: async () => {
      const used = referencedBy(kind, name);
      const msg = used.length ? `"${name}" is referenced by ${used.length} rule(s): ${used.join(", ")}. Delete anyway?` : `Delete "${name}"?`;
      if (!(await confirmDialog({ title: "Delete " + singular(kind) + "?", message: msg, confirmLabel: "Delete", danger: true }))) return;
      try { await session.apply((d) => d[kind].splice(idx, 1)); paint(root); toast("Deleted", "Staged to candidate.", "ok"); }
      catch (e) { toast("Failed", e.message, "bad"); }
    }, html: icon("trash", 16) }));
}

function referencedBy(kind, name) {
  const rules = session.draft.rules || [];
  const dims = kind === "zones" ? ["fromZones", "toZones"] : kind === "addresses" ? ["sourceAddresses", "destinationAddresses"] : ["services"];
  return rules.filter((r) => dims.some((d) => (r[d] || []).includes(name))).map((r) => r.name);
}

function addrTable(wrap, root) {
  const list = session.draft.addresses || [];
  if (!list.length) return void wrap.appendChild(emptyState("objects", "No address objects", "Create named hosts and networks to reuse in rules."));
  wrap.appendChild(table(["Name", "CIDR", "Description", ""], list.map((a, i) => h("tr", {},
    h("td", {}, h("strong", {}, a.name)),
    h("td", { class: "mono" }, a.cidr),
    h("td", { class: "muted" }, a.description || "—"),
    h("td", { style: { textAlign: "right" } }, rowActions("addresses", i, root, a.name))))));
}
function svcTable(wrap, root) {
  const list = session.draft.services || [];
  if (!list.length) return void wrap.appendChild(emptyState("objects", "No service objects", "Define protocol/port matchers to reuse in rules."));
  wrap.appendChild(table(["Name", "Protocol", "Ports", "Description", ""], list.map((s, i) => h("tr", {},
    h("td", {}, h("strong", {}, s.name)),
    h("td", {}, fmt.protoLabel(s.protocol)),
    h("td", { class: "mono" }, fmt.portList(s.ports)),
    h("td", { class: "muted" }, s.description || "—"),
    h("td", { style: { textAlign: "right" } }, rowActions("services", i, root, s.name))))));
}
function zoneTable(wrap, root) {
  const list = session.draft.zones || [];
  if (!list.length) return void wrap.appendChild(emptyState("objects", "No zones", "Group interfaces into security zones; rules match on zone pairs."));
  wrap.appendChild(table(["Name", "Interfaces", "Description", ""], list.map((z, i) => h("tr", {},
    h("td", {}, h("strong", {}, z.name)),
    h("td", {}, (z.interfaces || []).map((x) => h("span", { class: "tag" }, x))),
    h("td", { class: "muted" }, z.description || "—"),
    h("td", { style: { textAlign: "right" } }, rowActions("zones", i, root, z.name))))));
}

function table(headers, rows) {
  return h("table", {}, h("thead", {}, h("tr", {}, headers.map((x) => h("th", { style: x === "" ? { width: "90px" } : null }, x)))), h("tbody", {}, rows));
}

function editObject(kind, idx, root) {
  const editing = idx != null;
  const obj = editing ? structuredClone(session.draft[kind][idx]) : {};
  let body, save;
  const fld = (l, c, help) => h("label", { class: "field" }, h("span", {}, l, help ? h("span", { class: "help" }, " — " + help) : null), c);

  if (kind === "addresses") {
    const name = inp(obj.name, "web-server"), cidr = inp(obj.cidr, "10.0.0.5/32 or 2001:db8::/64"), desc = inp(obj.description, "");
    body = h("div", {}, fld("Name", name), fld("CIDR", cidr, "host uses /32 or /128"), fld("Description", desc));
    save = (d) => upsert(d, "addresses", idx, { name: val(name), cidr: val(cidr), description: val(desc) }, val(name) && val(cidr));
  } else if (kind === "services") {
    const name = inp(obj.name, "https");
    const proto = h("select", {}, ...["PROTOCOL_TCP", "PROTOCOL_UDP", "PROTOCOL_ICMP", "PROTOCOL_ANY"].map((p) => h("option", { value: p }, fmt.protoLabel(p))));
    proto.value = obj.protocol || "PROTOCOL_TCP";
    const ports = inp(fmt.portList(obj.ports) === "any" ? "" : fmt.portList(obj.ports), "443, 8000-8100");
    body = h("div", {}, fld("Name", name), fld("Protocol", proto), fld("Ports", ports, "comma-separated; ranges with a dash; empty for ICMP/Any"));
    save = (d) => upsert(d, "services", idx, { name: val(name), protocol: proto.value, ports: parsePorts(val(ports)) }, val(name));
  } else {
    const name = inp(obj.name, "lan");
    const ifaces = inp((obj.interfaces || []).join(", "), "eth1, eth2");
    const desc = inp(obj.description, "");
    body = h("div", {}, fld("Name", name), fld("Interfaces", ifaces, "comma-separated NIC names"), fld("Description", desc));
    save = (d) => upsert(d, "zones", idx, { name: val(name), interfaces: val(ifaces).split(",").map((x) => x.trim()).filter(Boolean), description: val(desc) }, val(name));
  }

  openDrawer({
    title: (editing ? "Edit " : "New ") + singular(kind), subtitle: "Stages to candidate.", width: "480px", body,
    footer: [h("button", { class: "btn ghost", onclick: closeDrawer }, "Cancel"),
      h("button", { class: "btn primary", onclick: async () => {
        try { let okFlag = true; await session.apply((d) => { okFlag = save(d); }); if (!okFlag) { toast("Missing fields", "Fill in the required fields.", "warn"); return; } closeDrawer(); paint(root); toast("Saved", "Staged to candidate.", "ok"); }
        catch (e) { toast("Failed", e.message, "bad"); }
      } }, "Save")],
  });
}

function upsert(d, kind, idx, obj, valid) {
  if (!valid) return false;
  if (!d[kind]) d[kind] = [];
  if (idx != null) d[kind][idx] = obj; else d[kind].push(obj);
  return true;
}
function inp(v, ph) { return h("input", { class: "input", value: v || "", placeholder: ph }); }
function val(el) { return el.value.trim(); }
