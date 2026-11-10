// src/config/appConfig.js
// Reads window.__ENV__ (set by public/env.js) and builds URLs for the app.
// Pages call these functions instead of reading import.meta.env.

const env = () => window.__ENV__ || {};

// ── Backend REST
// apiUrl("/auth/login") → /api/auth/login
export const apiUrl = (path = "") =>
  (env().API_BASE_URL || "") + (env().API_PREFIX ?? "/api") + path;

// ── Backend WebSocket
// wsEventsUrl("station_5") → ws(s)://host/ws/events?topics=station_5
export const wsEventsUrl = (topics = "") => {
  const base = env().API_BASE_URL;
  const origin = base
    ? base.replace(/^http/, "ws")
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
  const q = topics ? `?topics=${topics}` : "";
  return `${origin}${env().WS_PATH ?? "/ws/events"}${q}`;
};

// ── Synopsis service
// synopsisUrl("/face-jobs") → http://host:8005/a1/v1/synopsis/face-jobs
export const synopsisBase = () =>
  env().SYNOPSIS_BASE_URL || `http://${window.location.hostname}:8005`;

export const synopsisUrl = (path = "") =>
  synopsisBase() + (env().SYNOPSIS_PREFIX ?? "/a1/v1/synopsis") + path;

// Rewrites absolute/localhost media URLs from the backend so they go through the same-origin proxy
export const resolveSynopsisMediaUrl = (raw) => {
  if (!raw) return raw;
  try {
    const u = new URL(raw, window.location.origin);
    const isLocal = ["127.0.0.1", "localhost", "0.0.0.0"].includes(u.hostname);
    if (isLocal || /^\/a1\/v1\/synopsis/.test(u.pathname)) {
      const tail = u.pathname.replace(/^.*?\/a1\/v1\/synopsis/, "");
      return synopsisUrl(tail) + u.search;
    }
  } catch {}
  return raw;
};

// ── MediaMTX WHEP
const whepPrefix = () => env().WHEP_PREFIX ?? "/whep";

// whepUrl("cam1") → dev:  /whep/cam1/whep            (same origin, goes through Vite proxy)
//                   prod: http://host/whep/cam1/whep (nginx)
export const whepUrl = (streamKey) => {
  const path = `${whepPrefix()}/${streamKey}/whep`;
  if (import.meta.env.DEV) return path;
  return `${window.location.protocol}//${window.location.hostname}${path}`;
};

// Turns MediaMTX's Location header into a URL under the same /whep prefix as the POST.
// MediaMTX returns "/cam1/whep/<uuid>", which would otherwise lose the prefix.
export const whepSessionUrl = (location, streamKey) => {
  const base = new URL(whepUrl(streamKey), window.location.origin);
  const url = new URL(location, base);
  const prefix = whepPrefix();
  if (!url.pathname.startsWith(prefix + "/")) {
    url.pathname = prefix + url.pathname;
  }
  return url.toString();
};

// ── External AI through proxy
// externalAiUrl("/getalert?page=1") → /external-ai-api/getalert?page=1
export const externalAiUrl = (path = "") =>
  (env().EXTERNAL_AI_PREFIX ?? "/external-ai-api") + path;

// ── External AI direct (its own /unsecure paths)
// unsecureUrl("10.0.0.5", "/keybasedlogin", "3000") → http://10.0.0.5:3000/unsecure/keybasedlogin
export const unsecureUrl = (aiIp, path = "", port) =>
  `http://${aiIp}${port ? ":" + port : ""}${env().UNSECURE_PREFIX ?? "/unsecure"}${path}`;

// ── HLS
export const hlsBaseUrl = () =>
  env().HLS_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}/hls`;

// ── Prefixes, used by main.jsx to detect request types
export const prefixes = () => ({
  api: env().API_PREFIX ?? "/api",
  externalAi: env().EXTERNAL_AI_PREFIX ?? "/external-ai-api",
  unsecure: env().UNSECURE_PREFIX ?? "/unsecure",
});

// ── Plain getters
// getEnv("SSO_PORT") → "3000"
// getNumber("CAMERA_DEFAULT_PORT", 80) → 80
export const getEnv = (key, fallback = "") => env()[key] ?? fallback;
export const getNumber = (key, fallback) => Number(env()[key] ?? fallback);