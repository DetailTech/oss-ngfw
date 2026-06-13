// api.js — typed REST client over the canonical /v1 gateway. Holds the
// bearer token (when auth is enabled) in localStorage. Every mutation is
// the same candidate/commit path the CLI uses.

const TOKEN_KEY = "openngfw.token";

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

async function req(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = { message: text }; } }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data);
  }
  return data || {};
}

export const api = {
  version: () => req("GET", "/v1/system/version"),

  // Policy / candidate / commit
  getPolicy: (source, version) => {
    const q = new URLSearchParams();
    if (source) q.set("source", source);
    if (version) q.set("version", String(version));
    const qs = q.toString();
    return req("GET", "/v1/policy" + (qs ? "?" + qs : ""));
  },
  running: () => req("GET", "/v1/policy?source=POLICY_SOURCE_RUNNING"),
  candidate: () => req("GET", "/v1/policy?source=POLICY_SOURCE_CANDIDATE"),
  versionPolicy: (v) => req("GET", `/v1/policy?source=POLICY_SOURCE_VERSION&version=${v}`),
  setCandidate: (policy) => req("PUT", "/v1/candidate", { policy }),
  validate: () => req("POST", "/v1/candidate/validate", {}),
  commit: (comment) => req("POST", "/v1/commit", { comment }),
  rollback: (version) => req("POST", "/v1/rollback", { version: String(version) }),
  versions: (limit = 100) => req("GET", `/v1/versions?limit=${limit}`),
  audit: (limit = 200) => req("GET", `/v1/audit?limit=${limit}`),

  // Telemetry
  alerts: (limit = 200) => req("GET", `/v1/alerts?limit=${limit}`),
  flows: (limit = 200) => req("GET", `/v1/flows?limit=${limit}`),

  // Intel
  feeds: () => req("GET", "/v1/intel/feeds"),
  refreshFeeds: () => req("POST", "/v1/intel/refresh", {}),
};
