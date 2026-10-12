// ================= NAVIGATION CONFIGURATION =================
// Contains all navigation items for Mirador VMS

// ================= CORE NAVIGATION =================
const ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M2 4h20v16H2V4zm2 2v12h16V6H4z" fill="currentColor"/><polyline points="6,15.5 10,9.5 14,14 18,8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="15.5" r="1.8" fill="currentColor"/><circle cx="10" cy="9.5" r="1.8" fill="currentColor"/><circle cx="14" cy="14" r="1.8" fill="currentColor"/><circle cx="18" cy="8.5" r="1.8" fill="currentColor"/></svg>`,

  liveView: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>`,

  addDevice: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>`,

  cameras: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,

  cameraGroups: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,

  masking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/><path d="M3 8h2M19 8h2M3 16h2M19 16h2M8 3v2M16 3v2M8 19v2M16 19v2"/></svg>`,

  forensicSearch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>`,

  recording: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,

  storage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>`,

  playback: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><defs><mask id="mirador-play-mask"><rect width="24" height="24" fill="white" /><polygon points="10 8.5 15 12 10 15.5" fill="none" stroke="black" stroke-width="1.5" stroke-linejoin="round" /></mask></defs><circle cx="12" cy="12" r="7" fill="currentColor" stroke="none" mask="url(#mirador-play-mask)" /><circle cx="12" cy="12" r="10" stroke-dasharray="26 7 4 6 3 6 4 6.8" stroke-dashoffset="13" /></svg>`,

  backup: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16v-8M8 12l4-4 4 4"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>`,

  client: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,

  infrastructure: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><mask id="infra-mask"><rect x="0" y="0" width="24" height="24" fill="white" /><circle cx="12" cy="6" r="1.5" fill="black" /><path d="M12 18l-2.5-1 M12 18l2.5-1 M12 18v3 M4 18l-2.5-1 M4 18l2.5-1 M4 18v3 M20 18l-2.5-1 M20 18l2.5-1 M20 18v3" stroke="black" stroke-width="1.2" stroke-linecap="round" /></mask><g mask="url(#infra-mask)"><polygon points="12,16 14.5,17 14.5,20 12,21 9.5,20 9.5,17" fill="currentColor" /><polygon points="4,16 6.5,17 6.5,20 4,21 1.5,20 1.5,17" fill="currentColor" /><polygon points="20,16 22.5,17 22.5,20 20,21 17.5,20 17.5,17" fill="currentColor" /><rect x="10.8" y="2" width="2.4" height="8" rx="0.3" fill="currentColor" /><rect x="10.8" y="2" width="2.4" height="8" rx="0.3" fill="currentColor" transform="rotate(45 12 6)" /><rect x="10.8" y="2" width="2.4" height="8" rx="0.3" fill="currentColor" transform="rotate(90 12 6)" /><rect x="10.8" y="2" width="2.4" height="8" rx="0.3" fill="currentColor" transform="rotate(135 12 6)" /><circle cx="12" cy="6" r="3.2" fill="currentColor" /></g><path d="M7 6H4v8.5 M17 6h3v8.5 M12 11v3.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>`,

  about: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,

  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,

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
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
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
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8v8H8z"/><path d="M3 12h5M16 12h5"/></svg>`,
  },

  // ✅ INFRASTRUCTURE GROUP
  {
    section: "Infrastructure",
    icon: ICONS.infrastructure,
    items: [
      {
        label: "Topology Map",
        page: "topology-map",
        icon: ICONS.topology
      },

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
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
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

    // {
    //   label: "Raid Management",
    //   page: "raid-mgmt",
    //   icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6" y2="6"/><line x1="6" y1="18" x2="6" y2="18"/></svg>`
    // },

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
    {
      label: "Schedules",
      page: "schedules",
      icon: ICONS.schedules
    },

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
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
  },
];


// ================= INTEGRATION NAVIGATION =================
const INTEGRATION_NAV = {
  section: "Integration",
  page: "integration",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`,
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
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14"/>
      <rect x="1" y="6" width="15" height="12" rx="2"/>
    </svg>`,
  },

  {
    label: "Image Config",
    page: "image-config",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>`,
  },

  {
    label: "PTZ Presets",
    page: "ptz-presets",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 8l1.5 3h3l-2.5 2 1 3L12 14.5 9 16l1-3-2.5-2h3z"/>
    </svg>`,
  },
];


// ================= PAGE TITLE MAPPING =================
export const PAGE_TITLES = {
  // Core pages
  integration: "Integration",
  dashboard: "Dashboard",
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