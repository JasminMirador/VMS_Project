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
  env().SYNOPSIS_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:8005`;
 
export const synopsisUrl = (path = "") =>
  synopsisBase() + (env().SYNOPSIS_PREFIX ?? "/a1/v1/synopsis") + path;
 
// ── MediaMTX WHEP
const whepPrefix = () => env().WHEP_PREFIX ?? ":8889";
 
// whepUrl("cam1") → http://host:8889/cam1/whep
export const whepUrl = (streamKey) => {
  const prefix = whepPrefix();
  if (prefix.startsWith(":")) {
    return `${window.location.protocol}//${window.location.hostname}${prefix}/${streamKey}/whep`;
  }
  return `${prefix}/${streamKey}/whep`;
};
 
// Turns MediaMTX's Location header into a full URL
export const whepSessionUrl = (location, streamKey) => {
  if (!location) return "";
  try {
    const base = new URL(whepUrl(streamKey));
    const url = new URL(location, base);
    return url.toString();
  } catch (e) {
    return location;
  }
};
 
// ── External AI through proxy
// externalAiUrl("/getalert?page=1") → /external-ai-api/getalert?page=1
export const externalAiUrl = (path = "") =>
  (env().EXTERNAL_AI_PREFIX ?? "/external-ai-api") + path;
 
// ── External AI direct (its own /unsecure paths)
// unsecureUrl("10.0.0.5", "/status", "3000") → http://10.0.0.5:3000/unsecure/status
export const unsecureUrl = (aiIp, path = "", port) =>
  `http://${aiIp}${port ? ":" + port : ""}${env().UNSECURE_PREFIX ?? "/unsecure"}${path}`;
 
// ── HLS
export const hlsBaseUrl = () =>
  env().HLS_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:8888`;
 
// ── Prefixes, used by main.jsx to detect request types
export const prefixes = () => ({
  api: env().API_PREFIX ?? "/api",
  externalAi: env().EXTERNAL_AI_PREFIX ?? "/external-ai-api",
  unsecure: env().UNSECURE_PREFIX ?? "/unsecure",
});
 
// ── Plain getters
// getEnv("SSO_PORT") → "3000"
// getNumber("CAMERA_DEFAULT_PORT") → 80
export const getEnv = (key, fallback = "") => (env()[key] !== undefined && env()[key] !== null && env()[key] !== "" ? env()[key] : fallback);
export const getNumber = (key, fallback) => {
  const val = env()[key];
  if (val !== undefined && val !== null && val !== "") return Number(val);
  return fallback !== undefined ? Number(fallback) : NaN;
};