// policy.js — the editing session. Holds the running policy and a draft;
// every mutation auto-stages to the server *candidate* (PUT /v1/candidate),
// so nothing touches running config until an explicit commit. This is the
// candidate → validate → commit → rollback loop, surfaced in the UI.

import { api } from "./api.js";

function clone(o) { return o ? structuredClone(o) : o; }

// Stable JSON for value equality (sorts object keys).
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}
export const equal = (a, b) => stable(a) === stable(b);

class Session {
  constructor() {
    this.running = {};
    this.runningVersion = 0;
    this.draft = {};
    this.hasCandidate = false;
    this._subs = new Set();
  }

  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
  _notify() { this._subs.forEach((fn) => fn(this)); }

  async load() {
    const run = await api.running();
    this.running = run.policy || {};
    this.runningVersion = Number(run.version) || 0;
    try {
      const cand = await api.candidate();
      this.draft = cand.policy || clone(this.running);
      this.hasCandidate = !equal(this.draft, this.running);
    } catch (e) {
      // 404 → no candidate set yet.
      this.draft = clone(this.running);
      this.hasCandidate = false;
    }
    this._notify();
  }

  get dirty() { return !equal(this.draft, this.running); }

  // Section accessors return the live draft arrays (created if missing).
  list(section) { if (!this.draft[section]) this.draft[section] = []; return this.draft[section]; }

  /** Apply a mutation to the draft and persist it to the server candidate. */
  async apply(mutator) {
    const prev = clone(this.draft);
    mutator(this.draft);
    try {
      await api.setCandidate(this.draft);
      this.hasCandidate = this.dirty;
      this._notify();
    } catch (e) {
      this.draft = prev; // roll back local change on failure
      throw e;
    }
  }

  async discard() {
    await api.setCandidate(clone(this.running)); // candidate == running ⇒ clean
    this.draft = clone(this.running);
    this.hasCandidate = false;
    this._notify();
  }

  // validate and commit always (re)stage the draft first, so the server
  // candidate matches the local draft even if a pivot or inline-create
  // mutated the draft without going through apply().
  async validate() {
    await api.setCandidate(this.draft);
    return api.validate();
  }

  async commit(comment) {
    await api.setCandidate(this.draft);
    const res = await api.commit(comment);
    await this.load();
    return res;
  }

  /** Human summary of pending changes, e.g. "2 rules, 1 address". */
  changeSummary() {
    const out = [];
    const lists = {
      rules: "rule", zones: "zone", addresses: "address", services: "service", staticRoutes: "route",
    };
    for (const [sec, noun] of Object.entries(lists)) {
      const n = listDelta(this.running[sec], this.draft[sec]);
      if (n) out.push(`${n} ${noun}${n === 1 ? "" : noun.endsWith("s") ? "es" : "s"}`);
    }
    for (const sec of ["nat", "ids", "intel", "routing", "vpn", "network", "telemetry"]) {
      if (!equal(this.running[sec], this.draft[sec])) out.push(sec === "ids" ? "IDS/IPS" : sec);
    }
    return out;
  }

  changeCount() {
    let n = 0;
    for (const sec of ["rules", "zones", "addresses", "services", "staticRoutes"]) n += listDelta(this.running[sec], this.draft[sec]);
    for (const sec of ["nat", "ids", "intel", "routing", "vpn", "network", "telemetry"]) if (!equal(this.running[sec], this.draft[sec])) n++;
    return n;
  }
}

// Count entries that differ between two named-object lists (added,
// removed, or modified), keyed by name where available.
function listDelta(a = [], b = []) {
  a = a || []; b = b || [];
  const key = (x, i) => (x && x.name != null ? "n:" + x.name : "i:" + i);
  const ma = new Map(a.map((x, i) => [key(x, i), x]));
  const mb = new Map(b.map((x, i) => [key(x, i), x]));
  let n = 0;
  for (const [k, v] of mb) { if (!ma.has(k) || !equal(ma.get(k), v)) n++; }
  for (const k of ma.keys()) { if (!mb.has(k)) n++; }
  return n;
}

/** Pretty unified-ish line diff between running and draft policies. */
export function diffLines(running, draft) {
  const a = JSON.stringify(running, null, 2).split("\n");
  const b = JSON.stringify(draft, null, 2).split("\n");
  // Simple LCS-based line diff (fine for config-sized inputs).
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ t: "ctx", s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", s: a[i] }); i++; }
    else { out.push({ t: "add", s: b[j] }); j++; }
  }
  while (i < m) out.push({ t: "del", s: a[i++] });
  while (j < n) out.push({ t: "add", s: b[j++] });
  return out;
}

export const session = new Session();
