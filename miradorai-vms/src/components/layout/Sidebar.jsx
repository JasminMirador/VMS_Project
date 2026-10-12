import { useUserSettings } from "../../context/UserSettingsContext";
import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getNavConfig } from "../../data/navConfig";
import { tNav } from "../../translation/sidebarNav";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import logoImg from "../../assets/logo.jpg";
import Dock from "../shared/Dock/Dock";
import { createPortal } from "react-dom";

import "./Sidebar.css";

function SvgIcon({ html }) {
  return (
    <span
      className="nav-icon"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function Sidebar({ userRole,language = 'en' }) {
  // Display-only Arabic labels; keys/routes stay English.
  const L = (text) => tNav(text, language);
  const { settings } = useUserSettings();
  const { user, logout } = useAuth();
  const {
    firmwareUpdateCount,
    clearFirmwareBadge,
  } = useNotifications();

  const navigate = useNavigate();
  const location = useLocation();

  // ============================================================
  // Clear badge when visiting Device Management
  // ============================================================

  useEffect(() => {
    if (
      location.pathname === "/add-devices" &&
      firmwareUpdateCount > 0
    ) {
      clearFirmwareBadge();
    }
  }, [
    location.pathname,
    firmwareUpdateCount,
    clearFirmwareBadge,
  ]);

  // ============================================================
  // Active route
  // ============================================================

  const activePath = location.pathname;

  const toPath = (page) => `/${page}`;

  // ============================================================
  // Navigation configuration
  //
  // IMPORTANT:
  // Keep the source labels in English.
  // GTranslate should translate them.
  // ============================================================

  const navConfig = getNavConfig(
    userRole || user?.role
  );

  // ============================================================
  // Integration connections
  // ============================================================

  const [
    integrationConnections,
    setIntegrationConnections,
  ] = useState([]);

  useEffect(() => {
    let cancelled = false;

    const fetchIntegrationConnections =
      async () => {
        try {
          const token =
            localStorage.getItem("token");

          const headers = {
            Authorization: token
              ? `Bearer ${token}`
              : "",
          };

          const API_BASE =
            import.meta.env.VITE_API_URL || "";

          const res = await fetch(
            `${API_BASE}/api/integrations`,
            {
              headers,
            }
          );

          if (res.ok) {
            const data =
              await res.json();

            if (!cancelled) {
              setIntegrationConnections(
                Array.isArray(data)
                  ? data
                  : []
              );
            }
          }
        } catch (e) {
          // Silent failure
        }
      };

    fetchIntegrationConnections();

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  // ============================================================
  // Integration submenu
  //
  // NO Arabic hardcoded here.
  // ============================================================

  const resolvedNavConfig =
    navConfig.map((entry) => {
      if (
        entry.section !== "Integration"
      ) {
        return entry;
      }

      return {
        ...entry,

        items:
          integrationConnections.map(
            (conn) => ({
              label:
                conn.serverName ||
                conn.type ||
                "Unknown Connection",

              page:
                `integration/${
                  conn.id ||
                  conn._id
                }`,

              icon: entry.icon,
            })
          ),
      };
    });

  // ============================================================
  // Sidebar collapsed state
  // ============================================================

  const [
    isCollapsed,
    setIsCollapsed,
  ] = useState(() => {
    return (
      localStorage.getItem(
        "sidebar-collapsed"
      ) === "true"
    );
  });

  // ============================================================
  // Expanded groups
  // ============================================================

  const [
    expanded,
    setExpanded,
  ] = useState({
    Settings: true,
    Infrastructure: true,
  });

  // ============================================================
  // Search
  // ============================================================

  const [
    search,
    setSearch,
  ] = useState("");

    // Match the search text against the English key OR its Arabic label
  const matchesNav = (text) =>
    !search ||
    text.toLowerCase().includes(search.toLowerCase()) ||
    L(text).includes(search);

  // ============================================================
  // Collapsed rail: flyout panel with a group's sub-items
  // (opens on hover/click of a group icon, closes on leave/Esc/outside)
  // ============================================================

  const dockWrapRef = useRef(null);
  const flyoutRef = useRef(null);
  const closeTimer = useRef(null);
  const [flyout, setFlyout] = useState(null); // { idx, top, left | right }

  const cancelClose = () => clearTimeout(closeTimer.current);
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setFlyout(null), 180);
  };

  const openFlyoutFor = (idx) => {
    const entry = resolvedNavConfig[idx];
    const node = dockWrapRef.current?.querySelectorAll(".dock-item")[idx];
    const aside = node?.closest(".sidebar");
    if (!entry?.items?.length || !node || !aside) {
      setFlyout(null);
      return;
    }
    cancelClose();
    const r = node.getBoundingClientRect();
    const a = aside.getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    const estHeight = 52 + entry.items.length * 40 + 16;
    const top = Math.max(8, Math.min(r.top, window.innerHeight - estHeight - 8));
    setFlyout({
      idx,
      top,
      ...(rtl
        ? { right: window.innerWidth - a.left + 8 }
        : { left: a.right + 8 }),
    });
  };

  useEffect(() => {
    setFlyout(null);
  }, [location.pathname, isCollapsed]);

  useEffect(() => {
    if (!flyout) return undefined;
    const onDown = (e) => {
      if (
        flyoutRef.current?.contains(e.target) ||
        dockWrapRef.current?.contains(e.target)
      ) {
        return;
      }
      setFlyout(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setFlyout(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [flyout]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);
  // ============================================================
  // Collapse sidebar
  // ============================================================

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;

      localStorage.setItem(
        "sidebar-collapsed",
        String(next)
      );

      return next;
    });
  };
    // ============================================================
  // Toggle from the top bar (hamburger) + broadcast current state
  // ============================================================

  useEffect(() => {
    const handleToggle = () => toggleCollapse();
    window.addEventListener("toggle-sidebar", handleToggle);
    return () => window.removeEventListener("toggle-sidebar", handleToggle);
  }, []);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("sidebar-state", { detail: { collapsed: isCollapsed } })
    );
  }, [isCollapsed]);

  // ============================================================
  // Toggle group
  // ============================================================

  const toggle = (section) => {
    setExpanded((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // ============================================================
  // External collapse listener
  // ============================================================

  useEffect(() => {
    const handleCollapse = () => {
      setIsCollapsed(true);

      localStorage.setItem(
        "sidebar-collapsed",
        "true"
      );
    };

    window.addEventListener(
      "collapse-sidebar",
      handleCollapse
    );

    return () => {
      window.removeEventListener(
        "collapse-sidebar",
        handleCollapse
      );
    };
  }, []);

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <aside
      className={`sidebar ${
        isCollapsed
          ? "sidebar--collapsed"
          : ""
      }`}
      aria-label={L("Main navigation")}
    >
      {/* ======================================================
          LOGO
      ====================================================== */}

      <div className="sidebar__logo">
        <button
          className="sidebar__logo-btn"
          onClick={toggleCollapse}
          title={
            isCollapsed
              ? L("Expand Sidebar")
              : L("Collapse Sidebar")
          }
        >
          <div className="sidebar__logo-mark">
            <img
              src={logoImg}
              alt="MIRADOR"
              className="sidebar__logo-img"
            />
          </div>
        </button>

        {!isCollapsed && (
          <div className="sidebar__logo-text">
            <span className="sidebar__logo-name notranslate">
              {language === "ar" ? "ميرادور في إم إس" : "MIRADOR VMS"}
            </span>
            <span className="sidebar__logo-tagline">
              {L("Video Management System")}
            </span>
          </div>
        )}
      </div>

      {/* ======================================================
          SEARCH
      ====================================================== */}

      {!isCollapsed && (
        <div
          className="sidebar__search-wrap"
          role="search"
        >
          <svg
            className="sidebar__search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle
              cx="11"
              cy="11"
              r="8"
            />

            <path
              d="M21 21l-4.35-4.35"
            />
          </svg>

          <input
            className="sidebar__search"
            placeholder={L("Search...")}
            aria-label={L("Search menu")}
            value={search}
            onChange={(e) =>
              setSearch(
                e.target.value
              )
            }
          />
        </div>
      )}

      {/* ======================================================
          NAVIGATION
      ====================================================== */}

      {isCollapsed ? (
        <div
          ref={dockWrapRef}
          onMouseOver={(e) => {
            const el = e.target.closest?.(".dock-item");
            if (!el) return;
            const nodes = [
              ...dockWrapRef.current.querySelectorAll(".dock-item"),
            ];
            openFlyoutFor(nodes.indexOf(el));
          }}
          onMouseLeave={scheduleClose}
          style={{
            flex: 1,
            display: "flex",
            justifyContent:
              "center",
            paddingTop: "1rem",
          }}
        >
          <Dock
            direction="vertical"
            panelHeight={68}
            baseItemSize={44}
            magnification={64}
            distance={100}
            className="sidebar-dock"
            items={resolvedNavConfig.map(
              ({
                section,
                page,
                icon,
                items,
              }, idx) => {
                const isActive =
                  activePath ===
                    toPath(page) ||
                  items?.some(
                    (i) =>
                      activePath ===
                      toPath(i.page)
                  );

                return {
                  icon: (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: icon,
                      }}
                      style={{
                        color:
                          isActive
                            ? "var(--brand)"
                            : "inherit",
                        display: "flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                      }}
                    />
                  ),

                  // Display label (English key stays the source)
                  label: L(section),

                  onClick: () => {
                    if (items?.length) {
                      // Groups open the flyout with their sub-items
                      openFlyoutFor(idx);
                    } else if (page) {
                      navigate(
                        toPath(page)
                      );
                    // } else if (
                    //   items?.length
                    // ) {
                    //   navigate(
                    //     toPath(
                    //       items[0].page
                    //     )
                    //   );
                    }
                  },

                  className: `${
                    isActive
                      ? "sidebar__dock-item--active"
                      : ""
                  } ${
                    items?.length
                      ? "sidebar__dock-item--group"
                      : ""
                  }`,
                };
              }
            )}
          />
        </div>
      ) : (
        <nav
          className="sidebar__nav"
          role="navigation"
          aria-label={L("Application menu")}
        >
          {resolvedNavConfig.map(
            ({
              section,
              page,
              icon,
              items,
            }) => {

              // ==================================================
              // DIRECT ITEM
              // ==================================================

              if (
                page &&
                !items?.length
              ) {
                const isActive =
                  activePath ===
                  toPath(page);

                const matchesSearch =
                  matchesNav(section);


                if (
                  !matchesSearch
                ) {
                  return null;
                }

                return (
                  <button
                    key={section}
                    className={`sidebar__direct-item ${
                      isActive
                        ? "sidebar__direct-item--active"
                        : ""
                    }`}
                    onClick={() =>
                      navigate(
                        toPath(page)
                      )
                    }
                    aria-current={
                      isActive
                        ? "page"
                        : undefined
                    }
                    title={
                      isCollapsed
                        ? L(section)
                        : undefined
                    }
                  >
                    <SvgIcon
                      html={icon}
                    />

                    {!isCollapsed && (
                      <span
                        className="sidebar__direct-item-label"
                        translate="yes"
                      >
                        {L(section)}
                      </span>
                    )}

                    {isActive && (
                      <span className="sidebar__item-dot" />
                    )}
                  </button>
                );
              }

              // ==================================================
              // EXPANDABLE GROUP
              // ==================================================

              const visible =
                items?.filter(
                  (i) =>
                    matchesNav(i.label)

                ) || [];

              if (
                search &&
                visible.length ===
                  0
              ) {
                return null;
              }

              const hasActiveItem =
                (page &&
                  activePath ===
                    toPath(page)) ||
                items?.some(
                  (i) =>
                    activePath ===
                    toPath(i.page)
                );

              return (
                <div
                  key={section}
                  className="sidebar__group"
                  translate="yes"
                >
                  {/* ==========================================
                      GROUP BUTTON
                  ========================================== */}

                  <button
                    className={`sidebar__group-btn ${
                      hasActiveItem
                        ? "sidebar__group-btn--active"
                        : ""
                    }`}
                    onClick={() => {
                      if (
                        isCollapsed
                      ) {
                        if (
                          page ||
                          items?.[0]
                        ) {
                          navigate(
                            toPath(
                              page ||
                                items[0]
                                  .page
                            )
                          );
                        }
                      } else {
                        if (page) {
                          navigate(
                            toPath(page)
                          );
                        }

                        toggle(
                          section
                        );
                      }
                    }}
                    aria-expanded={
                      expanded[section]
                        ? "true"
                        : "false"
                    }
                    aria-controls={`group-${section
                      .replace(
                        /\s+/g,
                        "-"
                      )
                      .toLowerCase()}`}
                    title={
                      isCollapsed
                        ? L(section)
                        : undefined
                    }
                    translate="yes"
                  >
                    <SvgIcon
                      html={icon}
                    />

                    {!isCollapsed && (
                      <span
                        className="sidebar__group-label"
                        translate="yes"
                      >
                        {L(section)}
                      </span>
                    )}

                    {!isCollapsed && (
                      <svg
                        className={`sidebar__chevron ${
                          expanded[
                            section
                          ]
                            ? "sidebar__chevron--open"
                            : ""
                        }`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    )}
                  </button>

                  {/* ==========================================
                      IMPORTANT FIX

                      The submenu is ALWAYS mounted.

                      We only change display:
                      block <-> none

                      Therefore React does NOT destroy and
                      recreate the English text every time.

                      GTranslate can keep its Arabic translation.
                  ========================================== */}

                  {!isCollapsed && (
                    <div
                      className="sidebar__items"
                      id={`group-${section
                        .replace(
                          /\s+/g,
                          "-"
                        )
                        .toLowerCase()}`}
                      role="group"
                      aria-label={`${L(section)}`}
                      translate="yes"
                      style={{
                        display:
                          expanded[
                            section
                          ] || search
                            ? "block"
                            : "none",
                      }}
                    >
                      {visible.map(
                        (item) => {
                          const isActive =
                            activePath ===
                            toPath(
                              item.page
                            );

                          return (
                            <button
                              key={
                                item.page
                              }
                              className={`sidebar__item ${
                                isActive
                                  ? "sidebar__item--active"
                                  : ""
                              }`}
                              onClick={() =>
                                navigate(
                                  toPath(
                                    item.page
                                  )
                                )
                              }
                              aria-current={
                                isActive
                                  ? "page"
                                  : undefined
                              }
                              translate="yes"
                            >
                              <SvgIcon
                                html={
                                  item.icon
                                }
                              />

                              {/* 
                                IMPORTANT:
                                Original English source.
                                No Arabic hardcoding.
                              */}
                              <span
                                translate="yes"
                              >
                                {L(item.label)}

                              </span>

                              {item.page ===
                                "add-devices" &&
                                firmwareUpdateCount >
                                  0 && (
                                  <span className="sidebar__badge">
                                    {
                                      firmwareUpdateCount
                                    }
                                  </span>
                                )}

                              {isActive && (
                                <span className="sidebar__item-dot" />
                              )}
                            </button>
                          );
                        }
                      )}
                    </div>
                  )}
                </div>
              );
            }
          )}
        </nav>
      )}
      {/* ======================================================
          COLLAPSED RAIL FLYOUT (sub-items of the hovered group)
      ====================================================== */}
      {isCollapsed &&
        flyout &&
        resolvedNavConfig[flyout.idx] &&
        createPortal(
          (() => {
            const sec = resolvedNavConfig[flyout.idx];
            return (
              <div
                ref={flyoutRef}
                className="sidebar-flyout"
                role="menu"
                aria-label={L(sec.section)}
                style={{
                  top: flyout.top,
                  left: flyout.left,
                  right: flyout.right,
                }}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
              >
                {sec.page ? (
                  <button
                    type="button"
                    className="sidebar-flyout__title sidebar-flyout__title--link"
                    onClick={() => {
                      navigate(toPath(sec.page));
                      setFlyout(null);
                    }}
                  >
                    {L(sec.section)}
                  </button>
                ) : (
                  <div className="sidebar-flyout__title">
                    {L(sec.section)}
                  </div>
                )}

                <div className="sidebar-flyout__list">
                  {sec.items.map((item) => {
                    const isActive =
                      activePath === toPath(item.page);

                    return (
                      <button
                        key={item.page}
                        type="button"
                        role="menuitem"
                        className={`sidebar__item ${
                          isActive ? "sidebar__item--active" : ""
                        }`}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => {
                          navigate(toPath(item.page));
                          setFlyout(null);
                        }}
                      >
                        <span>{L(item.label)}</span>

                        {item.page === "add-devices" &&
                          firmwareUpdateCount > 0 && (
                            <span className="sidebar__badge">
                              {firmwareUpdateCount}
                            </span>
                          )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })(),
          document.body
        )}
    </aside>
  );
}