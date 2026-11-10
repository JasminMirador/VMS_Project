// public/env.js
// Runtime config. Loaded by index.html BEFORE the React app.
// Edit this file on each system after deployment. No rebuild needed.

(function () {
  var host = window.location.hostname;

  window.__ENV__ = {
    // --- Backend ---
    API_BASE_URL: "",              // "" = same origin (Vite proxy in dev, nginx in prod)
    API_PREFIX: "/api",
    API_HOST: host,
    API_PORT: "8000",
    EDGE_PORT: "8000",
    WS_PATH: "/ws/events",

    // --- Synopsis (same machine as backend) ---
    // Same-origin path; Vite (dev) or nginx (prod) forwards it to :8005
    SYNOPSIS_BASE_URL: "/synopsis-api",
    SYNOPSIS_PREFIX: "/a1/v1/synopsis",

    // --- MediaMTX / HLS ---
    WHEP_PREFIX: "/whep",
    HLS_BASE_URL: "",              // "" = app uses <origin>/hls

    // --- External AI server (different machine) ---
    EXTERNAL_AI_HOST: "192.168.126.201",
    EXTERNAL_AI_PORT: "8080",
    EXTERNAL_AI_SERVICE_PORT: "8006",
    EXTERNAL_AI_PREFIX: "/external-ai-api",   // via proxy / nginx
    UNSECURE_PREFIX: "/unsecure",             // on the AI server itself

    // --- MinIO (to finalise later) ---
    MINIO_PORT: "9000",

    // --- Devices ---
    CAMERA_DEFAULT_PORT: "80",
    CAMERA_RTSP_PORT: "554",
    SMB_PORT: "445",
    SSO_PORT: "3000",

    // --- WebRTC (STUN/TURN addresses only, no credentials) ---
    STUN_SERVER: "stun:stun.l.google.com:19302",
    TURN_SERVER_UDP: "turn:global.turn.twilio.com:3478?transport=udp",
    TURN_SERVER_TCP: "turn:global.turn.twilio.com:3478?transport=tcp",
    TURN_SERVER_TLS: "turn:global.turn.twilio.com:443?transport=tcp"
  };
})();

