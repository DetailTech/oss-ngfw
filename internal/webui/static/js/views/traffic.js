// Traffic — recent flows with app/protocol labels. Search, sort by
// volume, and pivot a flow into a new rule (the troubleshooting loop:
// "I can see this flow — now allow/deny it").

import { h, icon, clear } from "../core.js";
import { api } from "../api.js";
import { session } from "../policy.js";
import { pageHead, emptyState, pill, toast, openDrawer, closeDrawer, searchInput } from "../ui.js";
import * as fmt from "../format.js";
import { openRuleEditorPrefilled } from "./rules.js";

let state = { q: "", sort: "bytes" };

export async function render() {
  const data = await api.flows(500);
  const flows = data.flows || [];
  const root = h("div", {});
  paint(root, flows);
  return root;
}

function paint(root, flows) {
  clear(root);
  root.appendChild(pageHead("Traffic", `${flows.length} recent flows`,
    h("button", { class: "btn", onclick: () => location.reload() }, h("span", { html: icon("refresh", 16) }), "Refresh")));

  if (!flows.length) {
    root.appendChild(emptyState("traffic", "No flows yet", "Flow records appear once the inspection engine observes traffic. Enable IDS and generate traffic through the firewall."));
    return;
  }

  const { el: search } = searchInput("Search IP, app, protocol…", (v) => { state.q = v.toLowerCase(); repaint(); });
  const sortSel = h("select", { style: { maxWidth: "180px" }, onchange: (e) => { state.sort = e.target.value; repaint(); } },
    h("option", { value: "bytes" }, "Sort: most bytes"), h("option", { value: "time" }, "Sort: newest"), h("option", { value: "packets" }, "Sort: most packets"));
  sortSel.value = state.sort;
  root.appendChild(h("div", { class: "toolbar" }, search, sortSel));

  const wrap = h("div", { class: "table-wrap" });
  root.appendChild(wrap);
  function repaint() { renderTable(wrap, flows); }
  repaint();
}

function rows(flows) {
  let r = flows;
  if (state.q) r = r.filter((f) => [f.srcIp, f.destIp, f.appProtocol, f.protocol].join(" ").toLowerCase().includes(state.q));
  const total = (f) => fmt.num(f.bytesToServer) + fmt.num(f.bytesToClient);
  if (state.sort === "bytes") r = [...r].sort((a, b) => total(b) - total(a));
  else if (state.sort === "packets") r = [...r].sort((a, b) => fmt.num(b.packets) - fmt.num(a.packets));
  else r = [...r].sort((a, b) => (b.time || "").localeCompare(a.time || ""));
  return r;
}

function renderTable(wrap, flows) {
  clear(wrap);
  const r = rows(flows);
  if (!r.length) { wrap.appendChild(emptyState("search", "No matching flows", "Adjust your search.")); return; }
  wrap.appendChild(h("table", {},
    h("thead", {}, h("tr", {},
      h("th", {}, "App"), h("th", {}, "Proto"), h("th", {}, "Source"), h("th", {}, "Destination"),
      h("th", { class: "num" }, "↑ To server"), h("th", { class: "num" }, "↓ To client"), h("th", { class: "num" }, "Packets"),
      h("th", { style: { textAlign: "right" } }, ""))),
    h("tbody", {}, r.slice(0, 300).map((f) =>
      h("tr", {},
        h("td", {}, f.appProtocol ? pill(f.appProtocol.toUpperCase(), "info") : h("span", { class: "muted" }, "—")),
        h("td", {}, f.protocol || "—"),
        h("td", { class: "mono" }, fmt.endpoint(f.srcIp, f.srcPort)),
        h("td", { class: "mono" }, fmt.endpoint(f.destIp, f.destPort)),
        h("td", { class: "num" }, fmt.bytes(f.bytesToServer)),
        h("td", { class: "num" }, fmt.bytes(f.bytesToClient)),
        h("td", { class: "num" }, fmt.compactNum(fmt.num(f.packets))),
        h("td", { style: { textAlign: "right" } },
          h("button", { class: "btn sm ghost", title: "Create a rule from this flow", onclick: () => ruleFromFlow(f) }, h("span", { html: icon("rules", 15) }), "Rule")))))));
}

// Pivot: create address + service objects for this flow, then open a
// prefilled allow rule for review.
async function ruleFromFlow(f) {
  try {
    await session.load();
    const d = session.draft;
    const srcCidr = ipCidr(f.srcIp), dstCidr = ipCidr(f.destIp);
    const srcName = ensureAddr(d, srcCidr, "src-" + clean(f.srcIp));
    const dstName = ensureAddr(d, dstCidr, "dst-" + clean(f.destIp));
    const svcNames = [];
    if (f.destPort && f.protocol && f.protocol !== "ICMP") {
      const proto = "PROTOCOL_" + f.protocol.toUpperCase();
      const svcName = ensureSvc(d, proto, f.destPort, (f.appProtocol || f.protocol).toLowerCase() + "-" + f.destPort);
      svcNames.push(svcName);
    }
    openRuleEditorPrefilled({
      name: "flow-" + clean(f.srcIp) + "-to-" + clean(f.destIp),
      fromZones: [], toZones: [], sourceAddresses: [srcName], destinationAddresses: [dstName], services: svcNames,
      action: "ACTION_ALLOW", log: false, disabled: false,
      description: `From observed flow ${f.srcIp} → ${fmt.endpoint(f.destIp, f.destPort)} (${f.appProtocol || f.protocol || "ip"})`,
    });
  } catch (e) { toast("Failed", e.message, "bad"); }
}

function ipCidr(ip) { return ip && ip.includes(":") ? ip + "/128" : (ip || "0.0.0.0") + "/32"; }
function clean(ip) { return (ip || "x").replace(/[.:]/g, "-"); }
function ensureAddr(d, cidr, name) {
  const ex = (d.addresses || []).find((x) => x.cidr === cidr);
  if (ex) return ex.name;
  (d.addresses ||= []).push({ name, cidr });
  return name;
}
function ensureSvc(d, proto, port, name) {
  const ex = (d.services || []).find((x) => x.protocol === proto && (x.ports || []).some((p) => p.start === port && !p.end));
  if (ex) return ex.name;
  (d.services ||= []).push({ name, protocol: proto, ports: [{ start: port }] });
  return name;
}
