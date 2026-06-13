# OpenNGFW WebUI — Design & Plan

> Status: v1 design for the management WebUI. This documents the research,
> the design decisions, and the architecture. The UI is a **client of the
> canonical REST/gRPC API** — it holds no server-side state and every
> mutation flows through `candidate → validate → commit → (rollback)`,
> exactly like `ngfwctl` and GitOps. See [`build-plan.md`](build-plan.md)
> §3, §7 (M5), and the WebUI row in §5.

## 1. What we learned from the incumbents

We reviewed the management UIs of the major firewall products and the
recurring operator complaints (Reddit, vendor forums, product reviews).
The themes are remarkably consistent:

| Product | What operators praise | What they complain about |
|---|---|---|
| **Palo Alto (PAN-OS / Panorama)** | Powerful policy model; granular | GUI is **slow**; reports take forever; dashboard not streamlined; commit is heavyweight. Strata's headline wins were small ergonomics: *insert a rule after the selected one* and *show dependent apps* — i.e. rule-lifecycle friction. |
| **FortiGate (FortiOS)** | Fast when it works; feature-rich | **Cluttered** from feature density; "un-intuitive"; **log viewing is slow/awkward**; GUI/CLI state drift. |
| **pfSense** | Free, capable | **Low contrast / poor accessibility**; unclear what's clickable; **inconsistent buttons**; clunky top-menu navigation; dashboard hangs on a down WAN; no customization; weak mobile. |
| **OPNsense** | **Modern, slicker, consistent** (rewrote on an MVC framework); frequent design updates | Still form-heavy; some settings buried. |
| **Cisco (ASDM / FMC)** | Deep | Java fat-clients hated; FMC **slow deploys**; confusing. |

**Distilled lessons (what a top-tier UI must do):**

1. **Be fast and legible.** High contrast, obvious affordances, consistent
   buttons, no multi-minute hangs. Perceived speed beats feature count.
2. **Fight clutter with hierarchy and search.** Flat navigation, a global
   command palette (⌘K), and per-table filtering so density never means
   "lost."
3. **Make change management a first-class, *safe*, *visible* workflow.**
   The best-practice change pipeline operators describe by hand
   (request → review → push → document → verify) is exactly our
   `candidate → validate → commit → audit → rollback` loop. We surface it,
   we don't hide it. A persistent "candidate" state bar, an inline diff
   before commit, one-click rollback, and a complete audit trail.
4. **Rule-lifecycle ergonomics.** Insert-after, reorder, duplicate,
   enable/disable (disable-don't-delete for troubleshooting), clear naming,
   and static **shadow/unused detection** so operators can clean up.
5. **Close the observe→act loop.** From a blocked flow or an IDS alert, let
   the operator *pivot directly to a prefilled block/allow rule*. "Why is
   this traffic blocked?" should be answerable in the UI.
6. **Visuals carry the dashboard.** Operators want at-a-glance situational
   awareness: throughput, threats by severity, top talkers, change activity,
   feed/VPN posture — as charts, not walls of text.
7. **Dark and light themes; responsive.** Table stakes in 2026.

## 2. Top security-engineer workflows (what we optimize for)

In rough order of daily frequency, and how the UI serves each:

1. **Situational awareness** → **Dashboard**: live tiles + charts built from
   real telemetry (flows, alerts) and policy/version state.
2. **Rule management** (the #1 task) → **Policy ▸ Rules**: searchable,
   filterable table; create/edit in a side panel; reorder; insert-after;
   duplicate; enable/disable; shadow detection; everything stages to the
   candidate.
3. **Object management** → **Policy ▸ Objects**: zones, addresses, services
   — reusable, creatable inline from the rule editor.
4. **Threat triage** → **Threats**: IDS/IPS alerts with severity facets,
   drill-in, and **"block this source"** pivot.
5. **Traffic visibility / troubleshooting** → **Traffic**: flows by
   app/protocol, top talkers, and a **"create rule from this flow"** pivot.
6. **Threat intel** → **Intel**: feed posture, license compliance, refresh.
7. **Routing & VPN** → read-first status from running policy (BGP/OSPF,
   IPsec/WireGuard).
8. **Change management & compliance** → **Changes**: version history with
   diff + rollback, and the full audit log (who/what/when).
9. **Global / dataplane settings** → **Settings**: MTU/MSS/offloads, theme,
   API token.

## 3. Architecture decision: dependency-free, embedded SPA

The build plan's §5 table pencils in "React + TypeScript (later)." For v1 we
deliberately ship a **framework-free, no-build, single-page app** served as
static files embedded in `controld` via `go:embed`. Rationale:

- **Supply chain.** A firewall is a security product. A no-build UI adds
  **zero npm dependencies** to ship and audit, versus the hundreds a React +
  bundler tree pulls in. This is a feature, not a limitation.
- **Deterministic builds.** `make build` stays the single source of truth.
  No Node toolchain in CI, no committed minified bundles, no separate SBOM
  surface. Aligns with the repo guardrails (CLAUDE.md).
- **Reviewability.** Every byte the browser runs is readable source in the
  repo.
- **It does not cost us quality.** Visual polish comes from CSS and
  hand-crafted SVG, not from a framework. The app uses native ES modules, a
  ~100-line reactive store, and a tiny hash router.

If the project later wants React, the API contract and this UX are the spec;
the migration is mechanical. Nothing here blocks that.

### Layout (`internal/webui/static/`)

```
index.html          # app shell: sidebar, topbar, candidate bar, modals
css/app.css         # design tokens + components (dark/light themes)
js/core.js          # reactive store, hash router, DOM helpers (h/render)
js/api.js           # typed REST client over /v1/*, auth token handling
js/charts.js        # dependency-free SVG charts (area, donut, bars, spark)
js/format.js        # bytes/time/ip formatting, severity maps
js/app.js           # bootstrap: nav, command palette, theme, candidate bar
js/views/*.js       # one module per view (dashboard, rules, objects, …)
```

### Data sources (existing API only — no fabricated metrics)

The UI is built strictly on shipped endpoints; where a chart needs a series,
it is **aggregated client-side from real records**, never invented:

- `GET /v1/system/version`
- `GET /v1/policy?source=…&version=…` — running/candidate/historical
- `PUT /v1/candidate`, `POST /v1/candidate/validate`, `POST /v1/commit`,
  `POST /v1/rollback`
- `GET /v1/versions`, `GET /v1/audit`
- `GET /v1/alerts`, `GET /v1/flows`
- `GET /v1/intel/feeds`, `POST /v1/intel/refresh`

Dashboard charts: throughput/top-talkers from `/v1/flows`; threat timeline +
severity donut from `/v1/alerts`; change activity from `/v1/versions`; object
counts from `/v1/policy`. No CPU/memory/per-rule-hit gauges are shown because
the API does not expose them yet — we don't fake data on a security console.
(Future API additions for live system stats are noted as follow-ups.)

## 4. Editing model (safety first)

The UI never mutates running state directly. The flow mirrors `ngfwctl`:

1. Edits mutate an **in-browser draft** of the policy.
2. "Stage" pushes the draft to the server **candidate** (`PUT /v1/candidate`).
3. A persistent **candidate bar** shows "N pending changes" with **Diff**,
   **Validate**, **Commit** (requires a comment), and **Discard**.
4. **Validate** surfaces server errors inline before any commit.
5. **Commit** applies atomically and records a version; **Changes** offers
   one-click **rollback** to any prior version.

This makes the documented change pipeline operators ask for the default path,
and every action lands in the audit log with the authenticated actor.

## 5. TLS

Per the request, the management UI/API is served over **HTTPS with a
self-signed certificate**, generated on first run (ECDSA P-256, SANs for
`localhost`/`127.0.0.1`/`::1` and the host name) and persisted under
`<data-dir>/tls/`. Flags: `--tls` (default on), `--tls-cert`/`--tls-key` to
supply your own. Browsers show the expected "self-signed" warning until an
operator-provided cert is configured. This is a standard TLS server setup —
**not** TLS interception or a MITM CA (which remain a locked, human-only
effort per build plan §9).

## 6. Out of scope for this iteration

- OIDC/SAML login (scaffold only; needs human security review — guardrail).
- Live system-resource and per-rule-hit telemetry (needs new API surface).
- Editing routing/VPN/intel objects in the UI (read-first this round; rules,
  objects, zones, and network settings are editable).
</content>
</invoke>
