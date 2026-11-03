import { useState, useCallback, useEffect } from "react";
import Toggle from "../../components/shared/Toggle";
import { useUserSettings } from "../../context/UserSettingsContext";
import ServerFolderPicker from "../../components/shared/ServerFolderPicker";
import "./UserSettingsPage.css";
import { apiUrl } from "../../config/appConfig";

export default function UserSettingsPage() {
  const { settings, saveSettings } = useUserSettings();
  const [draft, setDraft] = useState(settings);
  const [toastMsg, setToastMsg] = useState("");
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [activePromoTab, setActivePromoTab] = useState(0);
  const [currentTime, setCurrentTime] = useState(() => new Date().toLocaleTimeString());

  // Clock in header
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  // Debounced auto-save effect
  useEffect(() => {
    const timer = setTimeout(() => {
      const hasChanges = Object.keys(draft).some(key => draft[key] !== settings[key]);
      if (hasChanges) {
        saveSettings(draft);
        setToastMsg("Settings saved automatically.");
        setTimeout(() => setToastMsg(""), 3000);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [draft, settings, saveSettings]);

  const updateDraft = (key, val) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
  };

  const handleBrowseFolder = async () => {
    if (window.electron?.showOpenDialog) {
      const result = await window.electron.showOpenDialog({ properties: ['openDirectory'] });
      if (!result.canceled && result.filePaths.length > 0) {
        updateDraft('snapFolder', result.filePaths[0]);
      }
    } else {
      try {
        const token = localStorage.getItem("token") || sessionStorage.getItem("token");
        const headers = token ? { "Authorization": `Bearer ${token}` } : {};

        const res = await fetch(apiUrl("/pick-folder"), { headers });
        const data = await res.json();
        if (data.success && data.path) {
          updateDraft('snapFolder', data.path);
        } else if (data.error !== "Canceled") {
          setIsPickerOpen(true);
        }
      } catch (err) {
        console.error("Failed to trigger native folder picker:", err);
        setIsPickerOpen(true);
      }
    }
  };

  const handlePlayBeep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 300);
    } catch(e) {
      console.error("Audio playback error:", e);
    }
  };

  const promoCards = [
    {
      title: "Stay informed, stay ahead",
      desc: "Real-time alerts and background activity at your fingertips."
    },
    {
      title: "Automated Surveillance",
      desc: "Fast snapshot captures and synchronized storage management."
    },
    {
      title: "Intelligent Workflows",
      desc: "Smart search integration and streamlined system initialization."
    }
  ];

  return (
    <div className="us-page-shell">
      {toastMsg && <div className="us-toast">{toastMsg}</div>}
      
      <ServerFolderPicker
        isOpen={isPickerOpen}
        initialPath={draft.snapFolder || "C:\\"}
        onClose={() => setIsPickerOpen(false)}
        onSelect={(path) => {
          updateDraft('snapFolder', path);
          setIsPickerOpen(false);
        }}
      />

      {/* ── Top Header Hero Banner ── */}
      <div className="us-header-banner">
        <div className="us-header-banner__bg-glow" />
        
        <div className="us-header-banner__left">
          <div className="us-header-banner__avatar-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="28" height="28">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div className="us-header-banner__text">
            <h1 className="us-page-title">User Settings</h1>
            <p className="us-page-desc">These settings apply to the current MIRADOR VMS user on this computer.</p>
          </div>
        </div>

        <div className="us-header-banner__right">
          <div className="us-header-banner__updated-pill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>Last updated: {currentTime}</span>
          </div>
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="us-grid">
        
        {/* ── 1. Notifications Card ── */}
        <div className="us-card">
          <div className="us-card__header">
            <div className="us-card__icon-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div className="us-card__titles">
              <div className="us-card__title">Notifications</div>
              <div className="us-card__subtitle">Show alerts in the Navigation panel and background tasks in the panel.</div>
            </div>
          </div>

          <div className="us-card__body">
            <div className="us-item-row">
              <div className="us-item-row__left">
                <span className="us-item-row__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </span>
                <span className="us-item-row__label">
                  Show alerts in Navigation panel
                  <span className="us-item-row__info-icon" title="Display system and camera alerts in the left navigation panel">ⓘ</span>
                </span>
              </div>
              <Toggle value={draft.notifAlarms} onChange={(v) => updateDraft('notifAlarms', v)} />
            </div>

            <div className="us-item-row">
              <div className="us-item-row__left">
                <span className="us-item-row__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <line x1="10" y1="9" x2="8" y2="9" />
                  </svg>
                </span>
                <span className="us-item-row__label">
                  Show background tasks in Navigation panel
                  <span className="us-item-row__info-icon" title="Display background scanning and export tasks in the navigation panel">ⓘ</span>
                </span>
              </div>
              <Toggle value={draft.notifTasks} onChange={(v) => updateDraft('notifTasks', v)} />
            </div>
          </div>
        </div>

        {/* ── 2. Promo Info Card (Stay Informed) ── */}
        <div className="us-card us-promo-card">
          <div className="us-promo-card__content">
            <div className="us-promo-card__text">
              <div className="us-promo-card__title">{promoCards[activePromoTab].title}</div>
              <div className="us-promo-card__desc">{promoCards[activePromoTab].desc}</div>
              <div className="us-promo-card__pagination">
                {promoCards.map((_, i) => (
                  <div
                    key={i}
                    className={`us-dot ${activePromoTab === i ? 'us-dot--active' : ''}`}
                    onClick={() => setActivePromoTab(i)}
                  />
                ))}
              </div>
            </div>

            <div className="us-promo-card__art">
              <svg className="us-promo-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                <circle cx="12" cy="8" r="1.5" />
              </svg>
              <div className="us-promo-soundwaves">
                <div className="us-wave-bar" />
                <div className="us-wave-bar" />
                <div className="us-wave-bar" />
                <div className="us-wave-bar" />
                <div className="us-wave-bar" />
                <div className="us-wave-bar" />
              </div>
            </div>
          </div>
        </div>

        {/* ── 3. Snapshot Card ── */}
        <div className="us-card">
          <div className="us-card__header">
            <div className="us-card__icon-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
            <div className="us-card__titles">
              <div className="us-card__title">Snapshot</div>
              <div className="us-card__subtitle">When a snapshot is taken show a message and open the snapshot folder.</div>
            </div>
          </div>

          <div className="us-snapshot-grid">
            <div className="us-snapshot-subrows">
              <div className="us-item-row">
                <div className="us-item-row__left">
                  <span className="us-item-row__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                  <span className="us-item-row__label">Show message when snapshot is taken</span>
                </div>
                <Toggle value={draft.snapMsg} onChange={(v) => updateDraft('snapMsg', v)} />
              </div>

              <div className="us-item-row">
                <div className="us-item-row__left">
                  <span className="us-item-row__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                      <line x1="8" y1="21" x2="16" y2="21" />
                      <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                  </span>
                  <span className="us-item-row__label">Open snapshot folder when snapshot is taken</span>
                </div>
                <Toggle value={draft.snapOpen} onChange={(v) => updateDraft('snapOpen', v)} />
              </div>
            </div>

            <div className="us-snapshot-folder-panel">
              <div className="us-snapshot-folder-label">
                <svg viewBox="0 0 24 24" fill="none" stroke="var(--teal, #10b981)" strokeWidth="2" width="16" height="16">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>Snapshot folder</span>
              </div>
              <div className="us-snapshot-folder-input-wrap">
                <div className="us-snapshot-input-box">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" style={{ color: 'var(--teal, #10b981)', flexShrink: 0 }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <input
                    type="text"
                    value={draft.snapFolder || ""}
                    onChange={(e) => updateDraft('snapFolder', e.target.value)}
                    placeholder="C:\screenshots"
                  />
                </div>
                <button className="us-browse-btn" onClick={handleBrowseFolder}>
                  Browse...
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── 4. Startup Card ── */}
        <div className="us-card">
          <div className="us-card__header">
            <div className="us-card__icon-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
              </svg>
            </div>
            <div className="us-card__titles">
              <div className="us-card__title">Startup</div>
              <div className="us-card__subtitle">Configure what happens when the application starts.</div>
            </div>
          </div>

          <div className="us-card__body">
            <div className="us-item-row">
              <div className="us-item-row__left">
                <span className="us-item-row__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </span>
                <span className="us-item-row__label">Start in full screen</span>
              </div>
              <Toggle value={draft.fullScreen} onChange={(v) => updateDraft('fullScreen', v)} />
            </div>

            <div className="us-item-row">
              <div className="us-item-row__left">
                <span className="us-item-row__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </span>
                <span className="us-item-row__label">Remember last used tabs</span>
              </div>
              <Toggle value={draft.remTabs} onChange={(v) => updateDraft('remTabs', v)} />
            </div>

            <div className="us-item-row">
              <div className="us-item-row__left">
                <span className="us-item-row__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                    <circle cx="12" cy="10" r="2" />
                  </svg>
                </span>
                <span className="us-item-row__label">Remember last used monitors</span>
              </div>
              <Toggle value={draft.remMonitors} onChange={(v) => updateDraft('remMonitors', v)} />
            </div>
          </div>
        </div>

        {/* ── 5. Sound on Alarm Card ── */}
        <div className="us-card">
          <div className="us-card__header">
            <div className="us-card__icon-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </div>
            <div className="us-card__titles">
              <div className="us-card__title">Sound on alarm</div>
              <div className="us-card__subtitle">Play a sound or beep when an alarm is triggered.</div>
            </div>
          </div>

          <div className="us-sound-card-body">
            <div className="us-sound-options">
              <div 
                className="us-radio-item" 
                onClick={() => updateDraft('alarmSound', 'no-sound')}
              >
                <div className={`us-radio-custom ${draft.alarmSound === 'no-sound' ? 'us-radio-custom--active' : ''}`}>
                  {draft.alarmSound === 'no-sound' && <div className="us-radio-inner-dot" />}
                </div>
                <span>No sound</span>
              </div>

              <div 
                className="us-radio-item" 
                onClick={() => updateDraft('alarmSound', 'beep')}
              >
                <div className={`us-radio-custom ${draft.alarmSound === 'beep' ? 'us-radio-custom--active' : ''}`}>
                  {draft.alarmSound === 'beep' && <div className="us-radio-inner-dot" />}
                </div>
                <span>Beep</span>
              </div>
            </div>

            <div className="us-sound-visualizer">
              <div className="us-audio-wave-bars">
                <div className="us-audio-bar" />
                <div className="us-audio-bar" />
                <div className="us-audio-bar" />
                <div className="us-audio-bar" />
                <div className="us-audio-bar" />
                <div className="us-audio-bar" />
                <div className="us-audio-bar" />
                <div className="us-audio-bar" />
                <div className="us-audio-bar" />
              </div>
              <button 
                className="us-play-circle-btn" 
                onClick={handlePlayBeep}
                title="Preview Beep Sound"
                disabled={draft.alarmSound === 'no-sound'}
              >
                <svg viewBox="0 0 24 24">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* ── 6. Features Card ── */}
        <div className="us-card">
          <div className="us-card__header">
            <div className="us-card__icon-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <div className="us-card__titles">
              <div className="us-card__title">Features</div>
              <div className="us-card__subtitle">Enable or disable smart search features.</div>
            </div>
          </div>

          <div className="us-card__body">
            <div className="us-item-row">
              <div className="us-item-row__left">
                <span className="us-item-row__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
                <span className="us-item-row__label">Show smart search 1</span>
              </div>
              <Toggle value={draft.smartSearch} onChange={(v) => updateDraft('smartSearch', v)} />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
