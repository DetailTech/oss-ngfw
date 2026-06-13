// app.js — bootstrap: sidebar nav, hash router, the candidate/commit bar,
// command palette (⌘K), theme, and connection status. Views are loaded
// per route and rendered into #content.

import { h, mount, clear, icon, $, Router } from "./core.js";
import { api } from "./api.js";
import { session, diffLines } from "./policy.js";
import { toast, openDrawer, closeDrawer, confirmDialog } from "./ui.js";

import * as dashboard from "./views/dashboard.js";
import * as rules from "./views/rules.js";
import * as objects from "./views/objects.js";
import * as threats from "./views/threats.js";
import * as traffic from "./views/traffic.js";
import * as intel from "./views/intel.js";
import * as netvpn from "./views/netvpn.js";
import * as changes from "./views/changes.js";
import * as settings from "./views/settings.js";

const NAV = [
  { path: "/", title: "Dashboard", icon: "dashboard", view: dashboard },
  { path: "/rules", title: "Security rules", crumb: "Rules", icon: "rules", view: rules },
  { path: "/objects", title: "Objects", icon: "objects", view: objects },
  { path: "/threats", title: "Threats", icon: "threats", view: threats },
  { path: "/traffic", title: "Traffic", icon: "traffic", view: traffic },
  { path: "/intel", title: "Threat intel", crumb: "Intel", icon: "intel", view: intel },
  { path: "/netvpn", title: "Routing & VPN", icon: "vpn", view: netvpn },
  { path: "/changes", title: "Changes", icon: "changes", view: changes },
  { path: "/settings", title: "Settings", icon: "settings", view: settings },
];

// ---------- Theme ----------
const THEME_KEY = "openngfw.theme";
export function getTheme() { return document.documentElement.getAttribute("data-theme") || "dark"; }
export function setTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);
  const btn = $("#theme-toggle");
  if (btn) btn.innerHTML = icon(t === "dark" ? "globe" : "shield", 18); // sun/moon-ish via available icons
}
function initTheme() {
  setTheme(localStorage.getItem(THEME_KEY) || "dark");
  $("#theme-toggle").onclick = () => setTheme(getTheme() === "dark" ? "light" : "dark");
}

// ---------- Nav ----------
function buildNav() {
  const nav = $("#nav");
  mount(nav, NAV.map((n) =>
    h("a", { href: "#" + n.path, dataset: { path: n.path }, html: icon(n.icon, 18) + "<span>" + n.title + "</span>" })));
}
function highlightNav(path) {
  $("#nav").querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.dataset.path === path));
}

// ---------- Router ----------
const router = new Router();
let currentRoute = null;
NAV.forEach((n) => router.add(n.path, n));

async function renderRoute(r) {
  currentRoute = r;
  const n = r.route;
  highlightNav(n.path);
  $("#crumb").textContent = n.crumb || n.title;
  document.title = "OpenNGFW · " + (n.crumb || n.title);
  $("#app").classList.remove("menu-open");
  const content = $("#content");
  mount(content, h("div", { class: "loading" }, "Loading…"));
  try {
    const node = await n.view.render({ params: r.params, query: r.query, path: r.path });
    mount(content, node);
    content.scrollTop = 0;
  } catch (e) {
    mount(content, h("div", { class: "alert-box bad" },
      h("strong", {}, "Could not load this view. "),
      e.message,
      e.status === 401 || e.status === 16 ? h("div", { style: { marginTop: "8px" } }, "Authentication may be required — set your API token in ",
        h("a", { href: "#/settings" }, "Settings"), ".") : null));
  }
}
function reloadCurrent() { if (currentRoute) renderRoute(currentRoute); }

// ---------- Candidate / commit bar ----------
function renderCandidateBar() {
  const bar = $("#candidate-bar");
  if (!session.dirty) { bar.hidden = true; clear(bar); return; }
  const summary = session.changeSummary();
  const count = session.changeCount();
  bar.hidden = false;
  mount(bar,
    h("span", { class: "cb-icon", html: icon("edit", 18) }),
    h("div", { class: "cb-text" },
      `${count} pending change${count === 1 ? "" : "s"}`,
      h("small", {}, summary.length ? "Staged: " + summary.join(", ") : "Uncommitted candidate — not yet enforced")),
    h("div", { class: "cb-actions" },
      h("button", { class: "btn sm ghost", onclick: showDiff }, h("span", { html: icon("diff", 15) }), "Diff"),
      h("button", { class: "btn sm", onclick: validate }, h("span", { html: icon("check", 15) }), "Validate"),
      h("button", { class: "btn sm danger", onclick: discard }, "Discard"),
      h("button", { class: "btn sm primary", onclick: commit }, h("span", { html: icon("upload", 15) }), "Commit")));
}

function showDiff() {
  const lines = diffLines(session.running, session.draft);
  openDrawer({
    title: "Pending changes", subtitle: "Candidate vs running policy", width: "720px",
    body: h("div", { class: "diff" }, lines.map((l) =>
      h("div", { class: "dl " + l.t }, h("span", { class: "gutter" }, l.t === "add" ? "+" : l.t === "del" ? "−" : " "), l.s))),
    footer: [h("button", { class: "btn ghost", onclick: closeDrawer }, "Close"),
      h("button", { class: "btn primary", onclick: () => { closeDrawer(); commit(); } }, "Commit…")],
  });
}

async function validate() {
  try {
    const r = await session.validate();
    if (r.valid) toast("Validation passed", "The candidate is valid and renderable.", "ok");
    else openDrawer({ title: "Validation failed", width: "560px",
      body: h("div", {}, h("p", { class: "note" }, "Fix these before committing:"),
        h("div", { class: "alert-box bad" }, h("ul", { style: { margin: 0, paddingLeft: "18px" } }, (r.errors || []).map((e) => h("li", {}, e))))),
      footer: [h("button", { class: "btn ghost", onclick: closeDrawer }, "Close")] });
  } catch (e) { toast("Validation error", e.message, "bad"); }
}

function commit() {
  const comment = h("textarea", { class: "input", placeholder: "Describe this change (recommended for the audit trail)" });
  openDrawer({
    title: "Commit changes", subtitle: "Validates, applies to the engines atomically, and records a new version.", width: "520px",
    body: h("div", {},
      h("p", { class: "note" }, `${session.changeCount()} change(s) will be applied to the live firewall. A new version is recorded; you can roll back from Changes.`),
      h("label", { class: "field" }, h("span", {}, "Comment"), comment)),
    footer: [h("button", { class: "btn ghost", onclick: closeDrawer }, "Cancel"),
      h("button", { class: "btn primary", onclick: async (e) => {
        const btn = e.target.closest("button"); btn.disabled = true; btn.textContent = "Committing…";
        try {
          const r = await session.commit(comment.value.trim());
          closeDrawer();
          toast("Committed", `Applied as version v${r.version}.`, "ok");
          reloadCurrent();
        } catch (err) {
          btn.disabled = false; btn.textContent = "Commit";
          toast("Commit failed", err.message, "bad");
        }
      } }, h("span", { html: icon("upload", 16) }), "Commit")],
  });
}

async function discard() {
  if (!(await confirmDialog({ title: "Discard pending changes?", message: "This resets the candidate to match the running policy. Your staged edits are lost. The live firewall is unaffected.", confirmLabel: "Discard", danger: true }))) return;
  try { await session.discard(); toast("Discarded", "Candidate reset to running policy.", "ok"); reloadCurrent(); }
  catch (e) { toast("Failed", e.message, "bad"); }
}

// ---------- Command palette ----------
let paletteItems = [], paletteActive = 0;
function openPalette() {
  const scrim = $("#palette-scrim"), input = $("#palette-input");
  scrim.hidden = false; input.value = ""; buildPalette("");
  input.focus();
  input.oninput = () => buildPalette(input.value);
  scrim.onclick = (e) => { if (e.target === scrim) closePalette(); };
}
function closePalette() { $("#palette-scrim").hidden = true; }

function buildPalette(q) {
  q = q.toLowerCase();
  const items = [];
  NAV.forEach((n) => items.push({ kind: "Page", icon: n.icon, label: n.title, run: () => (location.hash = "#" + n.path) }));
  items.push(
    { kind: "Action", icon: "plus", label: "Add rule", run: () => { location.hash = "#/rules"; setTimeout(() => rules.openRuleEditor(null), 60); } },
    { kind: "Action", icon: "refresh", label: "Refresh threat intel feeds", run: async () => { try { const r = await api.refreshFeeds(); toast("Feeds refreshed", `${r.entries || 0} entries.`, "ok"); } catch (e) { toast("Failed", e.message, "bad"); } } },
    { kind: "Action", icon: "diff", label: "Commit pending changes", run: () => { if (session.dirty) commit(); else toast("Nothing to commit", "No pending changes.", "warn"); } },
    { kind: "Action", icon: "globe", label: "Toggle theme", run: () => setTheme(getTheme() === "dark" ? "light" : "dark") });
  // Dynamic: rules and objects from the loaded draft.
  (session.draft.rules || []).forEach((r, i) => items.push({ kind: "Rule", icon: "rules", label: r.name || "(unnamed rule)", sub: (r.fromZones || ["any"]).join(",") + " → " + (r.toZones || ["any"]).join(","), run: () => { location.hash = "#/rules"; setTimeout(() => rules.openRuleEditor(i), 60); } }));
  (session.draft.addresses || []).forEach((a) => items.push({ kind: "Address", icon: "objects", label: a.name, sub: a.cidr, run: () => (location.hash = "#/objects?tab=addresses") }));
  (session.draft.services || []).forEach((s) => items.push({ kind: "Service", icon: "objects", label: s.name, run: () => (location.hash = "#/objects?tab=services") }));

  paletteItems = q ? items.filter((it) => (it.label + " " + (it.sub || "")).toLowerCase().includes(q)) : items.filter((it) => it.kind === "Page" || it.kind === "Action");
  paletteActive = 0;
  paintPalette();
}
function paintPalette() {
  const box = $("#palette-results");
  if (!paletteItems.length) { mount(box, h("div", { class: "palette-sec" }, "No matches")); return; }
  mount(box, paletteItems.slice(0, 40).map((it, i) =>
    h("div", { class: "palette-item" + (i === paletteActive ? " active" : ""), onclick: () => runPalette(i), onmouseenter: () => { paletteActive = i; paintPalette(); } },
      h("span", { html: icon(it.icon, 18) }),
      h("div", {}, h("div", {}, it.label), it.sub ? h("div", { class: "pi-sub" }, it.sub) : null),
      h("span", { class: "pi-kind" }, it.kind))));
}
function runPalette(i) { const it = paletteItems[i]; if (!it) return; closePalette(); it.run(); }

// ---------- Connection status ----------
async function pingConnection() {
  const conn = $("#conn"), text = $("#conn-text");
  try {
    const v = await api.version();
    conn.className = "conn ok"; text.textContent = "v" + (v.version || "?");
    text.title = "controld " + v.version + " (" + (v.commit || "") + ")";
  } catch (e) {
    conn.className = "conn bad";
    text.textContent = e.status === 401 || e.status === 16 ? "auth required" : "unreachable";
  }
}

// ---------- Boot ----------
function boot() {
  initTheme();
  buildNav();
  $("#menu-toggle").onclick = () => $("#app").classList.toggle("menu-open");
  $("#open-palette").onclick = openPalette;
  $("#palette-hint").onclick = openPalette;

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if ($("#palette-scrim").hidden) return;
    if (e.key === "Escape") closePalette();
    else if (e.key === "ArrowDown") { e.preventDefault(); paletteActive = Math.min(paletteActive + 1, paletteItems.length - 1); paintPalette(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); paletteActive = Math.max(paletteActive - 1, 0); paintPalette(); }
    else if (e.key === "Enter") { e.preventDefault(); runPalette(paletteActive); }
  });

  session.subscribe(renderCandidateBar);
  // Load the editing session once so the candidate bar reflects state on
  // any page; failures (e.g. auth) are surfaced by the view/connection.
  session.load().then(renderCandidateBar).catch(() => {});

  router.start(renderRoute);
  pingConnection();
  setInterval(pingConnection, 30000);
}

boot();
