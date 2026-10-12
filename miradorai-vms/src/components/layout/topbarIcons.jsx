// ============================================================
// TOP BAR ICONS — same visual language as the sidebar set
// (24px grid, 1.8 stroke, round caps, soft two-tone fill, currentColor)
//
//   <Icon name="snapshot" />            → React <svg>
//   iconSvg("userSettings")             → "<svg>…</svg>" string (dropdown items)
// ============================================================

const SOFT = 'fill="currentColor" fill-opacity="0.18"';
const SOLID = 'fill="currentColor" stroke="none"';

const BODY = {
  // ---- toolbar / dock ----
  snapshot: `<path d="M4 8.5A2.5 2.5 0 016.5 6H8l1.4-2h5.2L16 6h1.5A2.5 2.5 0 0120 8.5v9a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5z" ${SOFT}/><circle cx="12" cy="13" r="3.4"/><circle cx="17" cy="9.2" r=".8" ${SOLID}/>`,
  sun: `<circle cx="12" cy="12" r="4" ${SOFT}/><path d="M12 2.5v2M12 19.5v2M4.6 4.6L6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>`,
  moon: `<path d="M20 14.2A8 8 0 019.8 4a8 8 0 1010.2 10.2z" ${SOFT}/><path d="M17.5 3.5v3M16 5h3"/>`,
  refresh: `<path d="M20 11a8 8 0 00-14.4-4.2L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0014.4 4.2l1.6-1.7"/><path d="M20 20v-4.5h-4.5"/>`,
  profile: `<circle cx="12" cy="8" r="4" ${SOFT}/><path d="M4 21a8 8 0 0116 0"/>`,
  settings: `<path d="M4 6h9M18 6h2M4 12h3M12 12h8M4 18h11M20 18h0"/><circle cx="15.5" cy="6" r="2.3" ${SOFT}/><circle cx="9.5" cy="12" r="2.3" ${SOFT}/><circle cx="17.5" cy="18" r="2.3" ${SOFT}/>`,
  language: `<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>`,
  fullscreen: `<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M20 9V5.5A1.5 1.5 0 0018.5 4H15M4 15v3.5A1.5 1.5 0 005.5 20H9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15"/><rect x="9" y="9" width="6" height="6" rx="1.2" ${SOFT}/>`,
  fullscreenExit: `<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/><rect x="10.5" y="10.5" width="3" height="3" rx=".8" ${SOFT}/>`,
  panelClose: `<rect x="3" y="3" width="18" height="18" rx="3"/><rect x="3" y="3" width="6" height="18" ${SOFT} stroke="none"/><path d="M9 3v18M16 15l-3-3 3-3"/>`,
  panelOpen: `<rect x="3" y="3" width="18" height="18" rx="3"/><rect x="3" y="3" width="6" height="18" ${SOFT} stroke="none"/><path d="M9 3v18M14 9l3 3-3 3"/>`,

  // ---- user menu ----
  about: `<circle cx="12" cy="12" r="9" ${SOFT}/><path d="M12 16.5v-5"/><circle cx="12" cy="7.8" r=".9" ${SOLID}/>`,
  approvals: `<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" ${SOFT}/><path d="M8.5 12l2.5 2.5 4.5-5"/>`,
  supervisor: `<circle cx="8" cy="15" r="4" ${SOFT}/><path d="M10.9 12.1L20 3M16 7l3 3M13.5 9.5l2 2"/>`,
  logout: `<path d="M9 21H5.5A2.5 2.5 0 013 18.5v-13A2.5 2.5 0 015.5 3H9"/><path d="M16 17l5-5-5-5M21 12H9"/>`,

  // ---- settings dropdown ----
  userSettings: `<circle cx="9" cy="8" r="3.8" ${SOFT}/><path d="M2 21a7 7 0 0110-6.3"/><circle cx="18" cy="18" r="2.2"/><path d="M18 13.8v1M18 22.2v-1M13.8 18h1M22.2 18h-1"/>`,
  userManagement: `<circle cx="9" cy="8" r="3.5" ${SOFT}/><path d="M2 20a7 7 0 0114 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M18 14.2a5.5 5.5 0 013.9 5.3"/>`,
  emailSchedules: `<rect x="2.5" y="5" width="19" height="14" rx="2.5" ${SOFT}/><path d="M3 7.5l9 6 9-6"/>`,
  logs: `<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" ${SOFT}/><path d="M14 3v5h5M9 13h6M9 17h4"/>`,
  recycleBin: `<path d="M4 7h16M10 11v6M14 11v6"/><path d="M5.5 7l1 12a2 2 0 002 1.9h7a2 2 0 002-1.9l1-12" ${SOFT}/><path d="M9 7V4.5h6V7"/>`,
  clientSettings: `<circle cx="9" cy="8" r="3.8" ${SOFT}/><path d="M2 21a7 7 0 0110-6.3"/><circle cx="18" cy="18" r="2.2"/><path d="M18 13.8v1M18 22.2v-1M13.8 18h1M22.2 18h-1"/>`,
  deviceManagement: `<path d="M3 9a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2z" ${SOFT}/><path d="M15 11l6-3v8l-6-3"/><path d="M19 3v4M17 5h4"/>`,
};

const ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export function iconSvg(name) {
  return `<svg ${ATTRS}>${BODY[name] || ""}</svg>`;
}

export function Icon({ name, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
      dangerouslySetInnerHTML={{ __html: BODY[name] || "" }}
    />
  );
}
