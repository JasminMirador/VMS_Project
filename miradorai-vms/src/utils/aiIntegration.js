/**
 * Utility to resolve the Mirador AI server IP from the Integrations API.
 * Caches the result in localStorage so it's available without an extra network
 * call (e.g. inside AuthContext which runs before AiAnalyticsPage mounts).
 */

const AI_IP_CACHE_KEY = "miradorai_ai_server_ip";
const FALLBACK_IP = "192.168.126.35";

/**
 * Fetches the active AI integration IP from /api/integrations.
 * Caches the result in localStorage under `miradorai_ai_server_ip`.
 * Returns the IP string (without port), or the fallback if not found.
 */
export async function fetchAndCacheAiIp() {
  try {
    const token =
      (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token")) || localStorage.getItem("token");
    const API_BASE =
      (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
      "";
    const res = await fetch(API_BASE + "/api/integrations", {
      headers: token ? { Authorization: "Bearer " + token } : {},
    });

    if (!res.ok) throw new Error(`integrations API ${res.status}`);

    const data = await res.json();

    // Priority 1: active integration whose type or name contains "ai"
    const aiInt = data.find(
      (i) =>
        i.isActive &&
        (i.type?.toLowerCase().includes("ai") ||
          i.serverName?.toLowerCase().includes("ai"))
    );

    let ip = null;
    if (aiInt?.serverIp) {
      ip = aiInt.serverIp.split(":")[0];
    } else {
      // Priority 2: any first active integration with an IP
      const anyActive = data.find((i) => i.isActive && i.serverIp);
      if (anyActive?.serverIp) {
        ip = anyActive.serverIp.split(":")[0];
      }
    }

    if (ip) {
      localStorage.setItem(AI_IP_CACHE_KEY, ip);
      console.log("[AI-IP] Resolved AI server IP:", ip);
      return ip;
    }
  } catch (err) {
    console.warn("[AI-IP] Could not fetch integration IP:", err.message);
  }

  // Return cached value if available, else fallback
  return localStorage.getItem(AI_IP_CACHE_KEY) || FALLBACK_IP;
}

/**
 * Returns the cached AI server IP synchronously.
 * Falls back to FALLBACK_IP if not yet cached.
 */
export function getCachedAiIp() {
  return localStorage.getItem(AI_IP_CACHE_KEY) || FALLBACK_IP;
}
