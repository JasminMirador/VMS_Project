// Sample data used by DashboardNewPage ONLY when the API returns nothing for a section.
// Shapes match what the page normalises real data into.

const GROUPS = [
  { name: "Main gate", n: 8, issue: [], off: [] },
  { name: "Lobby", n: 10, issue: [6], off: [] },
  { name: "Parking", n: 16, issue: [11], off: [] },
  { name: "Warehouse", n: 14, issue: [], off: [2] },
  { name: "Perimeter", n: 10, issue: [4], off: [7] },
  { name: "Server room", n: 6, issue: [], off: [] },
];
const NAMED = {
  "Warehouse|2": "Warehouse, Dock 3",
  "Perimeter|7": "Perimeter, East 2",
  "Parking|11": "Parking, Ramp",
  "Lobby|6": "Lobby, Camera 4",
  "Perimeter|4": "Perimeter, North 1",
  "Main gate|0": "Main gate, Lane A",
  "Lobby|0": "Lobby, Entrance",
  "Server room|0": "Server room, Rack 1",
};
const REASON = { "Parking|11": "lowFps", "Lobby|6": "packetLoss", "Perimeter|4": "bitrateDrop" };

export const DEMO_FLEET = (() => {
  const out = [];
  GROUPS.forEach((g, gi) => {
    for (let i = 0; i < g.n; i++) {
      const key = `${g.name}|${i}`;
      const state = g.off.includes(i) ? "off" : g.issue.includes(i) ? "issue" : "on";
      out.push({
        name: NAMED[key] || `${g.name}, Camera ${i + 1}`,
        ip: `192.168.${10 * (gi + 1)}.${10 + i}`,
        group: g.name,
        state,
        reason: state === "off" ? "offline" : state === "issue" ? REASON[key] || "lowFps" : "online",
        stream: state === "off" ? "" : `${i % 3 === 0 ? "4K" : "1080p"}, ${state === "issue" ? 9 + i : 25} fps`,
        bitrate: state === "off" ? 0 : Number((2 + ((i * 7 + gi * 3) % 10) + (i % 4) * 0.3).toFixed(1)),
        uptime: state === "off" ? 94 + (i % 3) : state === "issue" ? 98.5 : 99.5 + (i % 5) / 10,
        lastSeen: state === "off" ? (gi === 3 ? 4 : 21) * 60 : 0,
      });
    }
  });
  return out;
})();

export const DEMO_SUMMARY = {
  streams: 57, alarms: 128, alarmsDelta: 18, peakStreams: 61, peakAt: "09:40",
  streamHist: [52, 54, 53, 55, 57, 58, 56, 59, 61, 60, 58, 57, 59, 57],
  alarmHist: [4, 3, 5, 9, 12, 10, 14, 18, 15, 12, 11, 13, 9, 12],
  cpu: 38, ram: 64, disk: 62,
  cpuHist: [31, 34, 29, 36, 42, 38, 35, 44, 41, 37, 33, 39, 45, 40, 36, 38, 41, 37, 34, 36, 39, 42, 38, 38],
  uptime: "18 d 6 h", version: "v1.0.0", status: "ok",
};

export const DEMO_HOURLY = [3, 2, 1, 2, 4, 6, 9, 14, 18, 15, 12, 10, 11, 9, 12];

export const DEMO_STORAGE = {
  total_gb: 20480, used_gb: 12697.6, free_gb: 7782.4, usage_pct: 62,
  avg_daily_consumption: 240, retention_days: 32, predicted_exhaustion_date: "2026-11-08", warning_status: false,
  trend_history: Array.from({ length: 31 }, (_, i) => ({
    timestamp: new Date(Date.now() - (30 - i) * 86400000).toISOString(),
    used_gb: (5.2 + (7.2 * i) / 30 + Math.sin(i * 1.3) * 0.12) * 1024,
  })),
};

export const DEMO_BITRATE = {
  current_bitrate: 142, avg_bitrate: 128, peak_bitrate: 187,
  trend_data: Array.from({ length: 48 }, (_, i) => {
    const h = i / 2;
    return { timestamp: new Date(Date.now() - (47 - i) * 1800000).toISOString(), bitrate_mbps: Math.round(95 + (h > 7 && h < 19 ? 45 : 0) + Math.sin(i * 0.7) * 12 + Math.sin(i * 0.23) * 10) };
  }),
};

export const DEMO_BANDWIDTH = {
  total_bandwidth: 142,
  top_cameras: [
    { name: "Parking, Ramp", ip: "192.168.10.41", bitrate: 12.4, percentage: 8.7 },
    { name: "Main gate, Lane A", ip: "192.168.10.11", bitrate: 11.8, percentage: 8.3 },
    { name: "Warehouse, Dock 1", ip: "192.168.20.11", bitrate: 10.9, percentage: 7.7 },
    { name: "Perimeter, North 1", ip: "192.168.30.11", bitrate: 9.6, percentage: 6.8 },
    { name: "Lobby, Entrance", ip: "192.168.11.10", bitrate: 8.7, percentage: 6.1 },
    { name: "Parking, Exit", ip: "192.168.10.44", bitrate: 8.1, percentage: 5.7 },
  ],
};

export const DEMO_OUTAGES = [
  { name: "Warehouse, Dock 3", count: 14 }, { name: "Perimeter, East 2", count: 9 },
  { name: "Parking, Ramp", count: 7 }, { name: "Lobby, Camera 4", count: 4 }, { name: "Gate, Lane B", count: 3 }, { name: "Warehouse, Dock 1", count: 3 }, { name: "Parking, Exit", count: 2 }, { name: "Server room, Rack 1", count: 1 },
];

export const DEMO_RIBBON = Array.from({ length: 30 }, (_, i) => (i === 29 ? "warn" : i === 16 ? "crit" : i === 7 || i === 25 ? "warn" : "ok"));
export const DEMO_AVAILABILITY = 99.2;

export const DEMO_ATTENTION = [
  { kind: "crit", reason: "offline", name: "Warehouse, Dock 3", ago: 4 * 60 },
  { kind: "crit", reason: "offline", name: "Perimeter, East 2", ago: 21 * 60 },
  { kind: "warn", reason: "lowFps", name: "Parking, Ramp", ago: 36 * 60 },
  { kind: "warn", reason: "packetLoss", name: "Lobby, Camera 4", ago: 52 * 60 },
  { kind: "warn", reason: "bitrateDrop", name: "Perimeter, North 1", ago: 3600 },
  { kind: "warn", reason: "lowFps", name: "Warehouse, Dock 1", ago: 4200 },
  { kind: "warn", reason: "packetLoss", name: "Parking, Exit", ago: 5400 },
];

const day = (i) => new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10);

export const DEMO_REPORT = (() => {
  const off = [1, 0, 2, 1, 3, 1, 0, 2, 6, 2, 1, 3, 4, 2];
  const names = DEMO_OUTAGES.map((o) => o.name);
  const alerts = [];
  off.forEach((n, d) => {
    for (let k = 0; k < n; k++) {
      const nm = names[(d + k) % names.length];
      alerts.push({ timestamp: `${day(d)}T${String(8 + k).padStart(2, "0")}:15:00`, ip: nm, model: nm, type: "camera", event: "device_offline", message: `${nm} went offline`, acknowledged: (d + k) % 4 === 0 ? "No" : "Yes" });
    }
  });
  const types = [["Intrusion", [8, 10, 9, 14, 18, 16, 12, 11, 15, 19, 23, 17, 14, 12]], ["Line crossing", [5, 4, 7, 6, 9, 8, 6, 10, 9, 12, 11, 8, 7, 6]], ["Loitering", [2, 3, 1, 4, 3, 5, 2, 3, 6, 4, 5, 3, 2, 4]], ["Object left behind", [1, 2, 1, 5, 3, 4, 2, 5, 4, 6, 7, 3, 5, 3]], ["Tamper", [2, 1, 3, 2, 3, 2, 1, 3, 2, 4, 3, 2, 1, 2]]];
  const cams = [["Parking, Ramp", 112], ["Main gate, Lane A", 86], ["Warehouse, Dock 3", 58], ["Perimeter, N1", 41], ["Lobby, Cam 4", 33], ["Gate, Lane B", 27]];
  const live = [];
  let c = 0;
  types.forEach(([type, arr]) => arr.forEach((n, d) => { for (let k = 0; k < Math.ceil(n / 3); k++) { live.push({ timestamp: `${day(d)}T${String(6 + (k % 12)).padStart(2, "0")}:30:00`, ip_address: cams[c++ % cams.length][0], classification: type, event: type, details: "—", status: k % 3 === 0 ? "Active" : k % 3 === 1 ? "Acknowledged" : "Resolved" }); } }));
  const lat = [6, 18, 17, 9, 5, 3, 2, 1, 1, 2];
  const health = [];
  let di = 0;
  lat.forEach((cnt, b) => { for (let k = 0; k < cnt; k++) { const ms = b * 10 + 3 + (k % 7); const g = GROUPS[di % GROUPS.length].name; health.push({ device_id: `dev-${di}`, ip_address: `192.168.${10 + (di % 6)}.${10 + di}`, manufacturer: g, model: "IPC", device_type: "camera", current_status: di % 32 === 5 ? "offline" : "online", latency_ms: `${ms} ms`, uptime_duration: "18d", online_since: "—", reboot_count: String(di < 5 ? 11 - di * 2 : di % 3), last_reboot: "—", _lat: ms, _group: g, _name: DEMO_FLEET[di % DEMO_FLEET.length].name }); di++; } });
  const history = DEMO_FLEET.slice(0, 16).map((f, i) => {
    const down = f.state === "off" ? 14 : f.state === "issue" ? 3 : i % 5 === 0 ? 1.5 : 0.4;
    return { camera_name: f.name, ip_address: f.ip, cam_up_hrs: "", cam_down_hrs: "", rec_up_hrs: "", rec_down_hrs: "", storage_consumed: `${(120 + i * 9).toFixed(2)} GB`, _up: 168 - down, _down: down, _rup: 168 - down * 1.3, _rdown: down * 1.3 };
  });
  return { alerts, live, health, history };
})();
