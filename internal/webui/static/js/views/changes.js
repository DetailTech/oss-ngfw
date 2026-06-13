// Changes — the compliance & change-management surface. Version history
// with diff and one-click rollback, and the full audit log of who did
// what. This is the documented change pipeline operators ask for.

import { h, icon, clear } from "../core.js";
import { api } from "../api.js";
import { session, diffLines } from "../policy.js";
import { pageHead, emptyState, pill, toast, openDrawer, closeDrawer, confirmDialog } from "../ui.js";
import * as fmt from "../format.js";

let tab = "versions";

export async function render(ctx) {
  if (ctx.query.tab) tab = ctx.query.tab;
  const root = h("div", {});
  await paint(root);
  return root;
}

async function paint(root) {
  clear(root);
  root.appendChild(pageHead("Changes", "Version history, diffs, rollback, and the audit trail."));
  root.appendChild(h("div", { class: "toolbar" }, h("div", { class: "seg" },
    h("button", { class: tab === "versions" ? "active" : "", onclick: () => { tab = "versions"; paint(root); } }, "Versions"),
    h("button", { class: tab === "audit" ? "active" : "", onclick: () => { tab = "audit"; paint(root); } }, "Audit log"))));
  const wrap = h("div", {});
  root.appendChild(wrap);
  if (tab === "versions") await versions(wrap, root); else await audit(wrap);
}

async function versions(wrap, root) {
  clear(wrap);
  let data, run;
  try { [data, run] = await Promise.all([api.versions(100), api.running()]); }
  catch (e) { wrap.appendChild(h("div", { class: "alert-box bad" }, e.message)); return; }
  const list = data.versions || [];
  const runningV = Number(run.version) || 0;
  if (!list.length) { wrap.appendChild(emptyState("changes", "No versions yet", "Commit a policy change to create the first version.")); return; }
  wrap.appendChild(h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", { style: { width: "90px" } }, "Version"), h("th", {}, "Comment"), h("th", {}, "Actor"), h("th", {}, "Committed"), h("th", { style: { textAlign: "right", width: "180px" } }, ""))),
    h("tbody", {}, list.map((v) => {
      const isRunning = Number(v.id) === runningV;
      return h("tr", {},
        h("td", {}, h("span", { class: "tag" }, "v" + v.id), isRunning ? pill("running", "ok", true) : null),
        h("td", {}, v.comment || h("span", { class: "muted" }, "(no comment)")),
        h("td", { class: "mono" }, v.actor || "—"),
        h("td", { class: "muted", title: fmt.absTime(v.createdAt) }, fmt.relTime(v.createdAt)),
        h("td", { style: { textAlign: "right" } }, h("div", { class: "flex", style: { justifyContent: "flex-end", gap: "6px" } },
          h("button", { class: "btn sm ghost", onclick: () => showDiff(v, run), title: "Compare to running" }, h("span", { html: icon("diff", 15) }), "Diff"),
          isRunning ? null : h("button", { class: "btn sm", onclick: () => rollback(v, root) }, h("span", { html: icon("rollback", 15) }), "Roll back"))));
    })))));
}

async function showDiff(v, run) {
  let vp;
  try { vp = await api.versionPolicy(v.id); } catch (e) { toast("Failed", e.message, "bad"); return; }
  const lines = diffLines(run.policy || {}, vp.policy || {});
  const changed = lines.some((l) => l.t !== "ctx");
  openDrawer({
    title: `Diff: running (v${run.version || 0}) → v${v.id}`,
    subtitle: changed ? "Lines that would change if you roll back to this version" : "Identical to the running policy",
    width: "720px",
    body: changed ? h("div", { class: "diff" }, lines.map((l) =>
      h("div", { class: "dl " + l.t }, h("span", { class: "gutter" }, l.t === "add" ? "+" : l.t === "del" ? "−" : " "), l.s)))
      : h("div", { class: "alert-box ok" }, "This version matches the running policy.",),
    footer: [h("button", { class: "btn ghost", onclick: closeDrawer }, "Close")],
  });
}

async function rollback(v, root) {
  if (!(await confirmDialog({
    title: "Roll back to v" + v.id + "?",
    message: `This re-applies version ${v.id} as a new commit and updates the live firewall. The current configuration stays in history. Continue?`,
    confirmLabel: "Roll back", danger: true,
  }))) return;
  try {
    const r = await api.rollback(v.id);
    toast("Rolled back", `Re-applied v${v.id} as new version v${r.version}.`, "ok");
    await session.load();
    paint(root);
  } catch (e) { toast("Rollback failed", e.message, "bad"); }
}

async function audit(wrap) {
  clear(wrap);
  let data;
  try { data = await api.audit(300); } catch (e) { wrap.appendChild(h("div", { class: "alert-box bad" }, e.message)); return; }
  const entries = data.entries || [];
  if (!entries.length) { wrap.appendChild(emptyState("clock", "No audit entries", "Configuration actions are recorded here.")); return; }
  const rows = entries.map((e) => h("tr", {},
    h("td", { class: "muted" }, e.id),
    h("td", {}, actionPill(e.action)),
    h("td", { style: { maxWidth: "420px" } }, e.detail || h("span", { class: "muted" }, "—")),
    h("td", { class: "mono" }, e.actor || "—"),
    h("td", {}, e.version && Number(e.version) ? h("span", { class: "tag" }, "v" + e.version) : h("span", { class: "muted" }, "—")),
    h("td", { class: "muted", style: { textAlign: "right" }, title: fmt.absTime(e.time) }, fmt.relTime(e.time))));
  const head = h("tr", {}, h("th", { style: { width: "70px" } }, "#"), h("th", {}, "Action"), h("th", {}, "Detail"), h("th", {}, "Actor"), h("th", {}, "Version"), h("th", { style: { textAlign: "right" } }, "Time"));
  wrap.appendChild(h("div", { class: "table-wrap" }, h("table", {}, h("thead", {}, head), h("tbody", {}, rows))));
}

function actionPill(a) {
  if (!a) return "—";
  if (a.includes("fail")) return pill(a, "bad");
  if (a === "commit") return pill(a, "ok");
  if (a === "rollback") return pill(a, "warn");
  if (a.includes("candidate")) return pill(a, "info");
  return pill(a, "neutral");
}
