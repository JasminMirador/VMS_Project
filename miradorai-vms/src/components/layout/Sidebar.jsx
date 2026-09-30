import { useUserSettings } from "../../context/UserSettingsContext";
import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { getNavConfig } from "../../data/navConfig";
import { useAuth } from "../../context/AuthContext";
import { useNotifications } from "../../context/NotificationContext";
import logoImg from "../../assets/logo.jpg";
import Dock from "../shared/Dock/Dock";
import "./Sidebar.css";

function SvgIcon({ html }) {
  return (
    <span
      className="nav-icon"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function Sidebar({ userRole }) {
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
      aria-label="Main navigation"
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
              ? "Expand Sidebar"
              : "Collapse Sidebar"
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
              MIRADOR VMS
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
            placeholder="Search..."
            aria-label="Search menu"
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
              }) => {
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
                            ? "var(--teal)"
                            : "inherit",
                        display: "flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                      }}
                    />
                  ),

                  // Keep original English text
                  label: section,

                  onClick: () => {
                    if (page) {
                      navigate(
                        toPath(page)
                      );
                    } else if (
                      items?.length
                    ) {
                      navigate(
                        toPath(
                          items[0].page
                        )
                      );
                    }
                  },

                  className:
                    isActive
                      ? "sidebar__dock-item--active"
                      : "",
                };
              }
            )}
          />
        </div>
      ) : (
        <nav
          className="sidebar__nav"
          role="navigation"
          aria-label="Application menu"
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
                  !search ||
                  section
                    .toLowerCase()
                    .includes(
                      search.toLowerCase()
                    );

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
                        ? section
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
                        {section}
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
                    !search ||
                    i.label
                      .toLowerCase()
                      .includes(
                        search.toLowerCase()
                      )
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
                        ? section
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
                        {section}
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
                        <path d="M9 18l6-6-6-6" />
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
                      aria-label={`${section} submenu`}
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
                                {
                                  item.label
                                }
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
    </aside>
  );
}