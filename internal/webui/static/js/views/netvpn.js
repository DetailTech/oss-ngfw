// Routing & VPN — read-first status from the running policy. Editing
// routing/VPN in the UI is a later step; today this surfaces what is
// configured (BGP/OSPF peers and announcements, IPsec tunnels, WireGuard
// interfaces/peers). Live tunnel up/down needs engine status the API
// does not yet expose, so we show configuration, clearly labelled.

import { h, clear } from "../core.js";
import { session } from "../policy.js";
import { pageHead, emptyState, pill, card } from "../ui.js";

export async function render() {
  await session.load();
  const p = session.running || {};
  const root = h("div", {},
    pageHead("Routing & VPN", "Configuration from the running policy (read-only this release)"),
    h("div", { class: "note", style: { marginBottom: "14px" } }, "Edit routing and VPN via ngfwctl or the API; in-UI editing arrives in a later milestone."),
    h("div", { class: "grid cols-2" }, bgpCard(p.routing?.bgp), ospfCard(p.routing?.ospf)),
    h("div", { style: { height: "16px" } }),
    h("div", { class: "grid cols-2" }, ipsecCard(p.vpn?.ipsecTunnels), wireguardCard(p.vpn?.wireguardInterfaces)));
  return root;
}

function bgpCard(bgp) {
  if (!bgp?.enabled) return card(h("h2", {}, "BGP", h("span", { class: "spacer" }), pill("disabled", "neutral")), emptyState("globe", "BGP not enabled", "No BGP configuration in the running policy."));
  return card(h("h2", {}, "BGP", h("span", { class: "spacer" }), pill("enabled", "ok", true)),
    h("dl", { class: "kv", style: { marginBottom: "12px" } },
      h("dt", {}, "Local ASN"), h("dd", { class: "mono" }, bgp.asn || "—"),
      h("dt", {}, "Router ID"), h("dd", { class: "mono" }, bgp.routerId || "—")),
    h("div", { class: "note" }, "Neighbors"),
    (bgp.neighbors || []).length ? h("table", {}, h("tbody", {}, bgp.neighbors.map((n) =>
      h("tr", {}, h("td", { class: "mono" }, n.address), h("td", {}, "AS " + n.remoteAsn), h("td", { class: "muted" }, n.description || "")))))
      : h("div", { class: "note" }, "none"),
    bgp.announceNetworks?.length ? h("div", { style: { marginTop: "10px" } }, h("div", { class: "note" }, "Announced"), bgp.announceNetworks.map((x) => h("span", { class: "tag" }, x))) : null);
}

function ospfCard(ospf) {
  if (!ospf?.enabled) return card(h("h2", {}, "OSPF", h("span", { class: "spacer" }), pill("disabled", "neutral")), emptyState("globe", "OSPF not enabled", "No OSPF configuration in the running policy."));
  return card(h("h2", {}, "OSPF", h("span", { class: "spacer" }), pill("enabled", "ok", true)),
    h("dl", { class: "kv", style: { marginBottom: "12px" } }, h("dt", {}, "Router ID"), h("dd", { class: "mono" }, ospf.routerId || "—")),
    h("div", { class: "note" }, "Areas"),
    (ospf.areas || []).map((a) => h("div", { style: { marginTop: "6px" } }, h("span", { class: "tag" }, "area " + a.area), (a.networks || []).map((n) => h("span", { class: "tag" }, n)))));
}

function ipsecCard(tunnels) {
  tunnels = tunnels || [];
  return card(h("h2", {}, "IPsec tunnels", h("span", { class: "spacer" }), h("span", { class: "muted" }, tunnels.length + " configured")),
    tunnels.length ? h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "Peer"), h("th", {}, "Subnets"), h("th", {}, "Mode"))),
      h("tbody", {}, tunnels.map((t) => h("tr", {},
        h("td", {}, h("strong", {}, t.name)),
        h("td", { class: "mono" }, (t.localAddress || "%any") + " ↔ " + (t.remoteAddress || "?")),
        h("td", {}, (t.remoteSubnets || []).map((s) => h("span", { class: "tag" }, s))),
        h("td", {}, t.initiate ? pill("initiator", "info") : pill("responder", "neutral"))))))
      : emptyState("vpn", "No IPsec tunnels", "No strongSwan tunnels in the running policy."));
}

function wireguardCard(ifaces) {
  ifaces = ifaces || [];
  return card(h("h2", {}, "WireGuard", h("span", { class: "spacer" }), h("span", { class: "muted" }, ifaces.length + " interface" + (ifaces.length === 1 ? "" : "s"))),
    ifaces.length ? ifaces.map((w) => h("div", { style: { marginBottom: "12px" } },
      h("div", { class: "flex" }, h("strong", {}, w.name), h("span", { class: "tag mono" }, w.address || ""), w.listenPort ? h("span", { class: "tag" }, "udp/" + w.listenPort) : null),
      h("div", { class: "note", style: { margin: "4px 0" } }, (w.peers || []).length + " peer(s)"),
      (w.peers || []).map((p) => h("div", { class: "flex", style: { gap: "6px" } }, h("span", { class: "mono muted" }, (p.name || "peer") + ":"), (p.allowedIps || []).map((a) => h("span", { class: "tag" }, a))))))
      : emptyState("vpn", "No WireGuard interfaces", "No WireGuard interfaces in the running policy."));
}
