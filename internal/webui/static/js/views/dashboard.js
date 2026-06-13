// Dashboard — at-a-glance situational awareness, built only from real
// API data (flows, alerts, policy, versions, feeds). Charts are
// client-side aggregations of actual records; no metrics are fabricated.

import { h, icon } from "../core.js";
import { api } from "../api.js";
import { pageHead, card, emptyState, pill } from "../ui.js";
import * as fmt from "../format.js";
import { area, donut, hbars } from "../charts.js";

export async function render() {
  const [run, alertsR, flowsR, versR, feedsR] = await Promise.allSettled([
    api.running(), api.alerts(500), api.flows(500), api.versions(8), api.feeds(),
  ]);
  const policy = ok(run)?.policy || {};
  const alerts = ok(alertsR)?.alerts || [];
  const flows = ok(flowsR)?.flows || [];
  const versions = ok(versR)?.versions || [];
  const feeds = ok(feedsR)?.feeds || [];

  const rules = policy.rules || [];
  const activeRules = rules.filter((r) => !r.disabled).length;
  const critical = alerts.filter((a) => fmt.severity(a.severity).n <= 2).length;
  const totalBytes = flows.reduce((s, f) => s + fmt.num(f.bytesToServer) + fmt.num(f.bytesToClient), 0);
  const enabledFeeds = feeds.filter((f) => f.enabled).length;

  const root = h("div", {},
    pageHead("Dashboard", `Running policy v${ok(run)?.version || 0} · ${relFresh(alerts, flows)}`,
      h("button", { class: "btn", onclick: () => location.reload() }, h("span", { html: icon("refresh", 16) }), "Refresh")),

    h("div", { class: "grid cols-4", style: { marginBottom: "16px" } },
      statTile("Active rules", activeRules, `${rules.length} total`, "rules",
        ruleSpark(rules)),
      statTile("Threats (recent)", alerts.length, `${critical} high/critical`, "threats",
        bucketSpark(alerts, "--bad")),
      statTile("Traffic (recent)", fmt.bytes(totalBytes), `${flows.length} flows`, "traffic",
        bytesSpark(flows)),
      statTile("Intel feeds", enabledFeeds, `${feeds.length} available`, "intel", null)),

    h("div", { class: "grid cols-3", style: { marginBottom: "16px" } },
      severityCard(alerts),
      talkersCard(flows),
      appsCard(flows)),

    h("div", { class: "grid cols-2" },
      recentThreatsCard(alerts),
      changeActivityCard(versions, ok(run)?.version || 0)));

  return root;
}

const ok = (r) => (r.status === "fulfilled" ? r.value : null);

function relFresh(alerts, flows) {
  const t = [...alerts, ...flows].map((x) => x.time).filter(Boolean).sort().pop();
  return t ? "telemetry updated " + fmt.relTime(t) : "no telemetry yet";
}

function statTile(label, value, foot, ico, spark) {
  return h("div", { class: "card tight stat-tile" },
    h("div", { class: "stat-ico", html: icon(ico, 22) }),
    h("div", { class: "stat" },
      h("span", { class: "stat-label" }, label),
      h("span", { class: "stat-value" }, String(value)),
      h("span", { class: "stat-foot" }, foot)),
    spark ? h("div", { class: "spark", html: spark }) : null);
}

function ruleSpark(rules) {
  // Bar-ish spark of allow vs deny composition is more meaningful than a series.
  const allow = rules.filter((r) => r.action === "ACTION_ALLOW").length;
  const deny = rules.length - allow;
  return area([allow, Math.max(allow, deny), deny || 1], { height: 42, color: getCss("--accent") });
}
function bucketSpark(items, colorVar) {
  return area(timeBuckets(items, 16).map((b) => b.length), { height: 42, color: getCss(colorVar) });
}
function bytesSpark(flows) {
  const buckets = timeBuckets(flows, 16).map((b) => b.reduce((s, f) => s + fmt.num(f.bytesToServer) + fmt.num(f.bytesToClient), 0));
  return area(buckets, { height: 42, color: getCss("--ok") });
}
function getCss(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

// Split items (with .time) into N equal time buckets across their range.
function timeBuckets(items, n) {
  const buckets = Array.from({ length: n }, () => []);
  const ts = items.map((x) => new Date(x.time).getTime()).filter((t) => !isNaN(t));
  if (!ts.length) return buckets;
  const min = Math.min(...ts), max = Math.max(...ts), span = max - min || 1;
  for (const x of items) {
    const t = new Date(x.time).getTime();
    if (isNaN(t)) continue;
    let i = Math.floor(((t - min) / span) * (n - 1));
    if (i < 0) i = 0; if (i >= n) i = n - 1;
    buckets[i].push(x);
  }
  return buckets;
}

function severityCard(alerts) {
  const colors = { 1: getCss("--bad"), 2: getCss("--warn"), 3: getCss("--info"), 4: getCss("--text-faint") };
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  alerts.forEach((a) => { counts[fmt.severity(a.severity).n]++; });
  const segs = [1, 2, 3, 4].map((n) => ({ value: counts[n], color: colors[n], label: fmt.severity(n === 4 ? 5 : n).label }));
  const body = alerts.length
    ? h("div", { class: "flex", style: { gap: "20px", justifyContent: "center" } },
        h("div", { html: donut(segs, { size: 168, center: alerts.length, sub: "alerts" }) }),
        h("div", { class: "legend", style: { flexDirection: "column", gap: "8px" } },
          [["Critical", 1], ["High", 2], ["Medium", 3], ["Low", 4]].map(([lbl, n]) =>
            h("div", { class: "li" }, h("span", { class: "sw", style: { background: colors[n] } }),
              h("span", {}, `${lbl} · ${counts[n]}`)))))
    : emptyState("threats", "No alerts", "IDS/IPS has not logged any detections yet.");
  return card(h("h2", {}, "Threats by severity"), body);
}

function talkersCard(flows) {
  const by = new Map();
  flows.forEach((f) => {
    const k = f.srcIp || "?";
    by.set(k, (by.get(k) || 0) + fmt.num(f.bytesToServer) + fmt.num(f.bytesToClient));
  });
  const items = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([ip, v]) => ({ label: ip, value: v, valueLabel: fmt.bytes(v) }));
  return card(h("h2", {}, "Top talkers"),
    items.length ? h("div", { html: hbars(items) }) : emptyState("traffic", "No flows", "No traffic has been observed yet."));
}

function appsCard(flows) {
  const by = new Map();
  flows.forEach((f) => { const k = (f.appProtocol || f.protocol || "unknown").toUpperCase(); by.set(k, (by.get(k) || 0) + 1); });
  const items = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([app, v]) => ({ label: app, value: v, valueLabel: v + " flows", color: getCss("--accent-2") }));
  return card(h("h2", {}, "Top applications"),
    items.length ? h("div", { html: hbars(items) }) : emptyState("traffic", "No application data", "App-layer labels appear once flows are inspected."));
}

function recentThreatsCard(alerts) {
  const top = [...alerts].sort((a, b) => fmt.severity(a.severity).n - fmt.severity(b.severity).n).slice(0, 6);
  const body = top.length
    ? h("table", {}, h("tbody", {}, top.map((a) => {
        const s = fmt.severity(a.severity);
        return h("tr", {},
          h("td", {}, pill(s.label, s.cls, true)),
          h("td", { class: "mono", style: { maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.signature || "—"),
          h("td", { class: "mono muted" }, a.srcIp || "—"),
          h("td", { class: "muted", style: { textAlign: "right" } }, fmt.relTime(a.time)));
      })))
    : emptyState("shield", "All clear", "No recent threats to review.");
  return card(h("h2", {}, "Recent threats", h("span", { class: "spacer" }), h("a", { href: "#/threats", class: "linklike" }, "View all →")), body);
}

function changeActivityCard(versions, runningV) {
  const body = versions.length
    ? h("table", {}, h("tbody", {}, versions.map((v) =>
        h("tr", {},
          h("td", {}, h("span", { class: "tag" }, "v" + v.id), Number(v.id) === runningV ? pill("running", "ok") : null),
          h("td", { style: { maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, v.comment || h("span", { class: "muted" }, "(no comment)")),
          h("td", { class: "muted" }, v.actor),
          h("td", { class: "muted", style: { textAlign: "right" } }, fmt.relTime(v.createdAt))))))
    : emptyState("changes", "No versions yet", "Committed policy versions will appear here.");
  return card(h("h2", {}, "Recent changes", h("span", { class: "spacer" }), h("a", { href: "#/changes", class: "linklike" }, "History →")), body);
}
