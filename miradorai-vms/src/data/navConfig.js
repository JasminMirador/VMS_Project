// ================= NAVIGATION CONFIGURATION =================
// Contains all navigation items for Mirador VMS

// ================= CORE NAVIGATION =================

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SOFT = 'fill="currentColor" fill-opacity="0.18"';   // duotone accent
const SOLID = 'fill="currentColor" stroke="none"';        // small solid accents

const ICONS = {
 // Dashboard — bento tiles of different sizes (widgets)
  dashboard: svg(`<rect x="3" y="3" width="8" height="10" rx="2" ${SOFT}/><rect x="13" y="3" width="8" height="6" rx="2"/><rect x="13" y="11" width="8" height="10" rx="2" ${SOFT}/><rect x="3" y="15" width="8" height="6" rx="2"/>`),

  // Live View — eye with a live (recording) pupil
  liveView: svg(`<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3.2" ${SOFT}/><circle cx="12" cy="12" r="1.2" ${SOLID}/>`),

  // Map View — location pin with ground ripple
  mapView: svg(`<path d="M12 17.5s-5.5-4.6-5.5-9a5.5 5.5 0 0111 0c0 4.4-5.5 9-5.5 9z" ${SOFT}/><circle cx="12" cy="8.5" r="2"/><ellipse cx="12" cy="20" rx="7" ry="2"/>`),

  // Playback — film strip with play head
  playback: svg(`<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="M7 4.5v15M17 4.5v15"/><path d="M10.5 9.2l4 2.8-4 2.8z" ${SOFT}/>`),

  // Designer View — layout editor (canvas + panels)
  designerView: svg(`<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/><rect x="3" y="9" width="6" height="12" ${SOFT} stroke="none"/><circle cx="6" cy="6" r=".8" ${SOLID}/><circle cx="9" cy="6" r=".8" ${SOLID}/>`),

  // Infrastructure — hub and connected nodes
  infrastructure: svg(`<circle cx="12" cy="12" r="3" ${SOFT}/><circle cx="12" cy="3.8" r="1.8"/><circle cx="4.5" cy="18" r="1.8"/><circle cx="19.5" cy="18" r="1.8"/><path d="M12 9V5.6M9.6 13.6l-3.9 3M14.4 13.6l3.9 3"/>`),

  // Topology Map — tree of linked devices
  topology: svg(`<rect x="8.5" y="2.5" width="7" height="5" rx="1.5" ${SOFT}/><rect x="2.5" y="16.5" width="7" height="5" rx="1.5"/><rect x="14.5" y="16.5" width="7" height="5" rx="1.5"/><path d="M12 7.5v4.5M6 16.5V12h12v4.5"/>`),

  // Network Health — heartbeat inside a shield
  networkHealth: svg(`<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" ${SOFT}/><path d="M7.5 12.5h2l1.4-3 2.4 6 1.4-3h1.8"/>`),

  // System Performance — speedometer gauge
  systemPerformance: svg(`<path d="M4.5 17a8.5 8.5 0 1115 0"/><path d="M12 14.5l3.8-4.6"/><circle cx="12" cy="14.5" r="1.6" ${SOFT}/><path d="M6.2 12.2l1 .5M12 7v1.1M17.8 12.2l-1 .5"/>`),

  // Settings — gear
  settings: svg(`<path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/><circle cx="12" cy="12" r="3" ${SOFT}/>`),

  // Integration — plug connecting external systems
  integration: svg(`<path d="M9 2.5v5M15 2.5v5"/><path d="M6 7.5h12v3.5a6 6 0 01-12 0z" ${SOFT}/><path d="M12 17v4.5"/>`),

  // Device Management — camera with add badge
  addDevice: svg(`<path d="M3 9a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2z" ${SOFT}/><path d="M15 11l6-3v8l-6-3"/><path d="M19 3v4M17 5h4"/>`),

  // Group Management — folder holding cameras
  cameras: svg(`<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" ${SOFT}/><circle cx="12" cy="13.5" r="2.6"/><circle cx="12" cy="13.5" r=".7" ${SOLID}/>`),

  // Storage Management — hard drive with activity LED
  storage: svg(`<path d="M3 14l2.6-8.2A2 2 0 017.5 4.5h9a2 2 0 011.9 1.3L21 14"/><rect x="3" y="14" width="18" height="6" rx="2" ${SOFT}/><circle cx="7" cy="17" r=".9" ${SOLID}/><path d="M11 17h6"/>`),

  // RAID Management — striped disk array
  raid: svg(`<rect x="3" y="3" width="18" height="5" rx="1.8" ${SOFT}/><rect x="3" y="9.5" width="18" height="5" rx="1.8"/><rect x="3" y="16" width="18" height="5" rx="1.8" ${SOFT}/><circle cx="6.8" cy="5.5" r=".8" ${SOLID}/><circle cx="6.8" cy="12" r=".8" ${SOLID}/><circle cx="6.8" cy="18.5" r=".8" ${SOLID}/>`),

  // Recording Method — record button
  recording: svg(`<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.2" ${SOFT}/><circle cx="12" cy="12" r="1.6" ${SOLID}/>`),

  // Schedules — calendar with time slots
  schedules: svg(`<rect x="3" y="5" width="18" height="16" rx="3" ${SOFT}/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8" cy="14" r=".9" ${SOLID}/><circle cx="12" cy="14" r=".9" ${SOLID}/><circle cx="16" cy="14" r=".9" ${SOLID}/><circle cx="8" cy="18" r=".9" ${SOLID}/><circle cx="12" cy="18" r=".9" ${SOLID}/>`),

  // Privacy Masking — pixel-masked region
  masking: svg(`<path d="M2 12s3.6-7 10-7c1.7 0 3.2.5 4.5 1.2M22 12s-1.3 2.5-3.8 4.5M9.5 18.6c.8.3 1.6.4 2.5.4 1.1 0 2.1-.2 3-.5"/><path d="M3 3l18 18"/><rect x="9.5" y="9.5" width="5" height="5" rx="1" ${SOFT}/>`),

  // Backup — database with restore arrow
  backup: svg(`<path d="M20 12a8 8 0 10-2.4 5.7"/><path d="M20 5.5V12h-6.5"/><ellipse cx="12" cy="10.6" rx="3.4" ry="1.5" ${SOFT}/><path d="M8.6 10.6v3.1c0 .8 1.5 1.5 3.4 1.5s3.4-.7 3.4-1.5v-3.1"/>`),

  // Viewing Stations — monitor with live eye
  client: svg(`<rect x="3" y="4" width="18" height="12" rx="2.5" ${SOFT}/><path d="M8 20h8M12 16v4"/><circle cx="12" cy="10" r="2"/><circle cx="12" cy="10" r=".7" ${SOLID}/>`),

  // Forensic Search — magnifier over a timeline
  forensicSearch: svg(`<circle cx="10.5" cy="10.5" r="7" ${SOFT}/><path d="M21 21l-5.2-5.2"/><path d="M10.5 7v3.6l2.3 1.4"/>`),

  about: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,

// ---- Camera features panel ----
  streamProfiles: svg(`<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M7.5 15v-2M12 15V9.5M16.5 15v-4.5" stroke-width="2.2"/>`),
  imageConfig: svg(`<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8" ${SOFT}/><path d="M3.5 17.5L9 13l4 3.5 3-2.5 4.5 4"/>`),
  ptz: svg(`<circle cx="12" cy="12" r="3" ${SOFT}/><path d="M9 5.5L12 2.5l3 3M9 18.5l3 3 3-3M5.5 9l-3 3 3 3M18.5 9l3 3-3 3"/>`),
  // ================= ONLY NEW UNIQUE ICONS =================

  // Analytics
  analytics: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19V3"/><path d="M2 19h21"/></svg>`,

  // Video Synopsis
  videoSynopsis: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h6M7 16h4"/><path d="M17 12l2 1.5-2 1.5z" fill="currentColor"/></svg>`,

  // Face Detection — face inside biometric scanning frame
  faceDetection: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3H5a2 2 0 00-2 2v2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><path d="M17 21h2a2 2 0 002-2v-2"/><circle cx="12" cy="10" r="3.5"/><path d="M8 18c1.1-2 2.4-3 4-3s2.9 1 4 3"/></svg>`,

  // Topology Map
  topology: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M10.5 7.2L6.5 15.8M13.5 7.2l4 8.6M7.5 18h9"/></svg>`,

  // Network Health
  networkHealth: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 4 10 2-5h6"/><circle cx="3" cy="12" r="1"/><circle cx="21" cy="12" r="1"/></svg>`,

  // Recording Schedules
  schedules: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><path d="M7 14h3M14 14h3M7 17h3"/></svg>`,
};


// ================= CORE NAVIGATION =================
const CORE_NAV = [
  // ✅ DASHBOARD
  {
    section: "Dashboard",
    page: "dashboard",
    icon: ICONS.dashboard,
  },

  // ✅ LIVE VIEW
  {
    section: "Live View",
    page: "live-view",
    icon: ICONS.liveView,
  },

  // ANALYTICS
  {
    section: "Analytics",
    icon: ICONS.analytics,
    items: [
      {
        label: "Video Synopsis",
        page: "video-synopsis",
        icon: ICONS.videoSynopsis
      },
      {
        label: "Face Detection",
        page: "face-detection",
        icon: ICONS.faceDetection
      },
    ],
  },

  // Map View
  {
    section: "Map View",
    page: "map-view",
    icon: ICONS.mapView,
  },
];


// ================= ADMIN ONLY NAVIGATION =================
const ADMIN_ONLY_NAV = [
  // ✅ MEDIA PLAYER
  {
    section: "Playback",
    page: "media-player",
    icon: ICONS.playback,
  },

  // ✅ FORENSIC SEARCH
  // {
  //   section: "Forensic Search",
  //   page: "forensic-search",
  //   icon: ICONS.forensicSearch,
  // },

  {
    section: "Designer View",
    page: "designer-view",
    icon: ICONS.designerView,
  },

  // ✅ INFRASTRUCTURE GROUP
  {
    section: "Infrastructure",
    icon: ICONS.infrastructure,
    items: [
      { label: "Topology Map", page: "topology-map", icon: ICONS.topology },
      { label: "Network Health", page: "network-health", icon: ICONS.networkHealth },
      { label: "System Performance", page: "system-performance", icon: ICONS.systemPerformance },

      // {
      //   label: "Network Health",
      //   page: "network-health",
      //   icon: ICONS.networkHealth
      // },

      // {
      //   label: "System Performance",
      //   page: "system-performance",
      //   icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M 3 14 Q 9 14 17 6" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /><polygon points="15,4 21,2 19,8" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" /><line x1="4.5" y1="15.5" x2="4.5" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /><line x1="9.5" y1="13.5" x2="9.5" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /><line x1="14.5" y1="10.5" x2="14.5" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /><line x1="19.5" y1="8" x2="19.5" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" /></svg>`
      // },
    ],
  },
];


// ================= CLIENT NAVIGATION =================
const CLIENT_NAV = [
  // Dashboard
  {
    section: "Dashboard",
    page: "dashboard",
    icon: ICONS.dashboard,
  },

  {
    section: "Live View",
    page: "live-view",
    icon: ICONS.liveView
  },

  {
    section: "Map View",
    page: "map-view",
    icon: ICONS.mapView,
  },

  {
    section: "Playback",
    page: "media-player",
    icon: ICONS.playback
  },
];


// ================= SETTINGS NAVIGATION =================
const SETTINGS_NAV = {
  section: "Settings",
  icon: ICONS.settings,
  items: [
    {
      label: "Device Management",
      page: "add-devices",
      icon: ICONS.addDevice
    },

    {
      label: "Group Management",
      page: "cameras",
      icon: ICONS.cameras
    },

    {
      label: "Storage Management",
      page: "storage-mgmt",
      icon: ICONS.storage
    },

    { label: "RAID Management", page: "raid-mgmt", icon: ICONS.raid },


    {
      label: "Recording Method",
      page: "rec-method",
      icon: ICONS.recording
    },

    {
      label: "Privacy Masking",
      page: "masking",
      icon: ICONS.masking
    },

    // CHANGED ONLY BECAUSE IT WAS IDENTICAL TO RECORDING METHOD
    { label: "Schedules", page: "schedules", icon: ICONS.schedules },


    {
      label: "Backup",
      page: "backup",
      icon: ICONS.backup
    },

    {
      label: "Viewing Stations",
      page: "viewing-stations",
      icon: ICONS.client
    },
  ],
};


// OPERATOR nav — Designer View only (Add Device and About moved to TopBar/Settings dropdown)
const OPERATOR_NAV = [
  {
    section: "Live View",
    page: "live-view",
    
    icon: ICONS.liveView,
  },

  {
    section: "Map View",
    page: "map-view",
    icon: ICONS.mapView,
  },
];


// ================= INTEGRATION NAVIGATION =================
const INTEGRATION_NAV = {
  section: "Integration",
  page: "integration",
  icon: ICONS.integration,
  items: []
};


// ================= GET NAVIGATION CONFIG =================
export const getNavConfig = (role = "client") => {
  const filteredSettings = {
    ...SETTINGS_NAV,
    items: SETTINGS_NAV.items.filter(item => {
      if (role === "client") {

        return !["raid-mgmt", "viewing-stations", "user-management"].includes(item.page);
      }

      if (item.page === "user-management") {
        return role === "admin";
      }

      return true;
    })
  };

  if (role === "admin") {
    return [
      ...CORE_NAV,
      ...ADMIN_ONLY_NAV,
      filteredSettings,
      INTEGRATION_NAV
    ];
  }

  if (role === "client") {
    return [
      ...CLIENT_NAV,
      filteredSettings,
      INTEGRATION_NAV
    ];
  }

  if (role === "operator") {
    return OPERATOR_NAV;
  }

  return [
    ...CLIENT_NAV,
    filteredSettings,
    INTEGRATION_NAV
  ];
};


// ================= DEFAULT EXPORT =================
export const NAV_CONFIG = [
  ...CORE_NAV,
  ...ADMIN_ONLY_NAV,
  SETTINGS_NAV,
  INTEGRATION_NAV
];


// ================= CAMERA FEATURES CONFIG =================
// All features shown in the right-side panel when a camera is selected.
export const CAMERA_FEATURES_CONFIG = [
  {
    label: "Stream Profiles",
    page: "stream-profiles",
    icon: ICONS.streamProfiles,

  },

  {
    label: "Image Config",
    page: "image-config",
    icon: ICONS.imageConfig,

  },

  {
    label: "PTZ Presets",
    page: "ptz-presets",
    icon: ICONS.ptz,

  },
];


// ================= PAGE TITLE MAPPING =================
export const PAGE_TITLES = {
  // Core pages
  integration: "Integration",
  dashboard: "Dashboard",
  "dashboard-new": "Dashboard (New)",

  "live-view": "Live View",
  analytics: "Video Analytics",
  "add-devices": "Device Management-",
  cameras: "Cameras",
  schedules: "Recording Schedules",
  "rec-method": "Recording Method",
  "action-rules": "Action Rules",
  "storage-mgmt": "Storage Management",
  "raid-mgmt": "RAID Management",
  "client-settings": "Client Settings",
  "user-settings": "User Settings",
  "user-management": "User Management",
  "email-schedules": "Email Schedules",
  profile: "Profile",
  about: "About",

  // Admin pages
  "media-player": "Playback",
  backup: "Backup",
  logs: "System Logs",
  infrastructure: "Infrastructure",

  // Camera feature pages
  "stream-profiles": "Stream Profiles",
  "image-config": "Image Configuration",
  "ptz-presets": "PTZ Presets",
  masking: "Privacy Masking",
  "camera-features": "Camera Features",
  "io-ports": "I/O Ports",
  "ext-data": "External Data",
  "time-sync": "Time Synchronization",
  "device-mgmt": "Device Management",
  "analytics-rules": "Analytics Rules",
  "designer-view": "Designer View",
  "system-performance": "System Performance & Scaling",
};


// ================= HELPER FUNCTION =================
export const getPageTitle = (pageId) => {
  return PAGE_TITLES[pageId] || pageId?.replace(/-/g, ' ') || "Mirador VMS";
};