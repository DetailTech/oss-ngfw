// ui.js — shared UI primitives: toasts, the right-side drawer, confirm
// dialogs, and small presentational helpers used across views.

import { h, mount, clear, icon, $ } from "./core.js";

// ---------- Toasts ----------
export function toast(title, body, kind = "") {
  const host = $("#toasts");
  const close = () => { el.style.opacity = "0"; el.style.transform = "translateX(12px)"; setTimeout(() => el.remove(), 180); };
  const el = h("div", { class: "toast " + kind, style: { transition: "all .18s ease" } },
    h("div", {},
      h("div", { class: "t-title" }, title),
      body ? h("div", { class: "t-body" }, body) : null),
    h("button", { class: "t-close", onClick: close, html: icon("x", 16) }));
  host.appendChild(el);
  setTimeout(close, kind === "bad" ? 8000 : 4500);
  return el;
}

// ---------- Drawer ----------
export function openDrawer({ title, subtitle, body, footer, width }) {
  const scrim = $("#drawer-scrim"), drawer = $("#drawer");
  if (width) drawer.style.width = width;
  mount(drawer,
    h("div", { class: "drawer-head" },
      h("div", {},
        h("h2", {}, title),
        subtitle ? h("div", { class: "note" }, subtitle) : null),
      h("button", { class: "icon-btn", onClick: closeDrawer, html: icon("x", 20) })),
    h("div", { class: "drawer-body" }, body),
    footer ? h("div", { class: "drawer-foot" }, footer) : null);
  scrim.hidden = false; drawer.hidden = false;
  scrim.onclick = closeDrawer;
  document.addEventListener("keydown", escClose);
}
export function closeDrawer() {
  $("#drawer-scrim").hidden = true;
  const d = $("#drawer"); d.hidden = true; clear(d); d.style.width = "";
  document.removeEventListener("keydown", escClose);
}
function escClose(e) { if (e.key === "Escape") closeDrawer(); }

// ---------- Confirm ----------
export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false, body }) {
  return new Promise((resolve) => {
    const done = (v) => { closeDrawer(); resolve(v); };
    openDrawer({
      title,
      width: "440px",
      body: h("div", {}, message ? h("p", {}, message) : null, body || null),
      footer: [
        h("button", { class: "btn ghost", onClick: () => done(false) }, "Cancel"),
        h("button", { class: "btn " + (danger ? "danger" : "primary"), onClick: () => done(true) }, confirmLabel),
      ],
    });
  });
}

// ---------- Presentational helpers ----------
export function pill(text, cls = "neutral", withDot = false) {
  return h("span", { class: "pill " + cls }, withDot ? h("span", { class: "pdot" }) : null, text);
}

export function emptyState(iconName, title, sub, action) {
  return h("div", { class: "empty" },
    h("div", { html: icon(iconName, 40) }),
    h("h3", {}, title),
    sub ? h("div", {}, sub) : null,
    action ? h("div", { style: { marginTop: "14px" } }, action) : null);
}

export function pageHead(title, sub, actions) {
  return h("div", { class: "page-head" },
    h("div", {},
      h("h1", {}, title),
      sub ? h("div", { class: "sub" }, sub) : null),
    h("div", { class: "spacer" }),
    actions ? h("div", { class: "flex wrap" }, actions) : null);
}

export function searchInput(placeholder, onInput, value = "") {
  const input = h("input", { class: "input", type: "search", placeholder, value, oninput: (e) => onInput(e.target.value) });
  return { el: h("div", { class: "search-input" }, h("span", { html: icon("search", 16) }), input), input };
}

export function tags(list, faint) {
  return (list && list.length ? list : faint ? ["any"] : []).map((t) =>
    h("span", { class: "tag" }, t));
}

export function card(titleNode, ...children) {
  return h("div", { class: "card" },
    titleNode ? h("div", { class: "card-head" }, titleNode) : null, ...children);
}
