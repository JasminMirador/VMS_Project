import { useState, useEffect, useRef } from "react";

const css = `
  .sum-overlay {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(6,8,14,0.82);
    backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    animation: sumFadeIn .18s ease;
  }
  @keyframes sumFadeIn { from { opacity:0 } to { opacity:1 } }

  .sum-card {
    font-family: var(--font-ui);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    width: 500px;
    box-shadow: var(--shadow-lg);
    animation: sumSlideUp .22s cubic-bezier(.22,1,.36,1);
    overflow: hidden;
  }
  @keyframes sumSlideUp { from { transform:translateY(24px); opacity:0 } to { transform:translateY(0); opacity:1 } }

  .sum-header {
    padding: 22px 24px 18px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: flex-start; justify-content: space-between;
  }
  .sum-eyebrow {
    font-size: 13px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--teal); font-weight: 600; margin-bottom: 4px;
  }
  .sum-title {
    font-family: var(--font-ui);
    font-size: var(--font-size-subheading); font-weight: 700; color: var(--text-primary); margin: 0;
  }
  .sum-close {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); padding: 2px; transition: color var(--transition);
  }
  .sum-close:hover { color: var(--teal); }

  .sum-body { padding: 24px; display: flex; flex-direction: column; gap: 16px; }

  .sum-desc {
    font-size: var(--font-size-content); color: var(--text-secondary); line-height: 1.6;
    background: var(--bg-base); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 12px 14px;
    display: flex; gap: 10px; align-items: flex-start;
  }
  .sum-desc svg { flex-shrink: 0; margin-top: 1px; color: var(--teal); }

  .sum-field { display: flex; flex-direction: column; gap: 6px; }
  .sum-label {
    font-size: 13px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--text-secondary); font-weight: 600;
  }
  .sum-input {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-ui);
    font-size: var(--font-size-content);
    padding: 10px 13px;
    outline: none;
    transition: border-color var(--transition), box-shadow var(--transition);
    width: 100%;
    box-sizing: border-box;
  }
  .sum-input::placeholder { color: var(--text-muted); }
  .sum-input:focus {
    border-color: var(--teal);
    box-shadow: 0 0 0 3px var(--teal-glow);
  }
  .sum-input.error { border-color: var(--red); box-shadow: 0 0 0 3px rgba(220,38,38,.15); }
  .sum-error-msg { font-size: 14px; color: var(--red); }

  .sum-custom-select { position: relative; width: 100%; }
  .sum-select-btn {
    background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-primary); font-family: var(--font-ui); font-size: var(--font-size-content);
    padding: 10px 13px; outline: none; width: 100%; text-align: left;
    display: flex; justify-content: space-between; align-items: center;
    cursor: pointer; transition: border-color var(--transition), box-shadow var(--transition);
  }
  .sum-select-btn:focus { border-color: var(--teal); box-shadow: 0 0 0 3px var(--teal-glow); }
  .sum-dropdown-menu {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg); z-index: 999;
    padding: 6px; list-style: none; margin: 0;
    max-height: 200px; overflow-y: auto;
  }
  .sum-dropdown-menu::-webkit-scrollbar { width: 6px; }
  .sum-dropdown-menu::-webkit-scrollbar-track { background: transparent; }
  .sum-dropdown-menu::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 3px; }
  .sum-dropdown-menu::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  .sum-dropdown-item {
    padding: 8px 12px; color: var(--text-secondary); font-size: var(--font-size-content); cursor: pointer;
    border-radius: 4px; display: flex; align-items: center; transition: all var(--transition);
  }
  .sum-dropdown-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .sum-dropdown-item.active { background: var(--teal-subtle); color: var(--teal); font-weight: 500; }

  /* URL list */
  .sum-url-list {
    display: flex; flex-direction: column; gap: 8px;
    max-height: 165px; overflow-y: auto; padding-right: 4px;
  }
  .sum-url-list::-webkit-scrollbar { width: 6px; }
  .sum-url-list::-webkit-scrollbar-track { background: transparent; }
  .sum-url-list::-webkit-scrollbar-thumb { background: var(--border-light); border-radius: 3px; }
  .sum-url-list::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
  .sum-url-item {
    display: flex; align-items: center; gap: 8px;
    background: var(--bg-base); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 10px 12px;
  }
  .sum-url-text {
    flex: 1; font-size: 15px; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sum-url-remove {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); padding: 2px; transition: color var(--transition); flex-shrink: 0;
  }
  .sum-url-remove:hover { color: var(--red); }

  /* add row */
  .sum-add-row { display: flex; gap: 8px; }
  .sum-add-row .sum-input { flex: 1; }

  .sum-btn-add {
    font-family: var(--font-ui); font-size: var(--font-size-content); font-weight: 600;
    padding: 10px 16px; border-radius: var(--radius-sm); cursor: pointer;
    border: 1px solid var(--teal); background: var(--teal-subtle); color: var(--teal);
    white-space: nowrap; transition: all var(--transition); flex-shrink: 0;
  }
  .sum-btn-add:hover { background: var(--teal-glow); }

  /* footer */
  .sum-footer {
    padding: 16px 24px 20px;
    border-top: 1px solid var(--border);
    display: flex; justify-content: flex-end; gap: 10px;
  }
  .sum-btn {
    font-family: var(--font-ui); font-size: var(--font-size-content); font-weight: 600;
    padding: 9px 18px; border-radius: var(--radius-sm); cursor: pointer;
    border: 1px solid transparent; transition: all var(--transition);
  }
  .sum-btn--ghost {
    background: transparent; border-color: var(--border-light); color: var(--text-primary);
  }
  .sum-btn--ghost:hover { border-color: var(--teal); color: var(--teal); }
  .sum-btn--primary {
    background: var(--teal); border-color: var(--teal); color: #fff;
  }
  .sum-btn--primary:hover:not(:disabled) { background: var(--teal-dim); }
  .sum-btn:disabled { opacity: .35; cursor: not-allowed; }
  .sum-ui-alert {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: var(--red);
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-content);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    animation: sumAlertFadeIn 0.2s ease;
    margin-bottom: 4px;
  }
  @keyframes sumAlertFadeIn {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .sum-ui-alert-icon {
    flex-shrink: 0; color: var(--red); margin-top: 1px;
  }
  .sum-ui-alert-text {
    flex: 1; line-height: 1.5;
  }
  .sum-ui-alert-close {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 18px; line-height: 1; padding: 2px;
    transition: color var(--transition);
  }
  .sum-ui-alert-close:hover { color: var(--red); }
`;


function validateURL(url) {
  return /^(rtsp|rtsps|http|https):\/\/.+/.test(url.trim());
}

export default function StreamURLModal({
  onClose,
  onAdd,
  groups,
  selectedGroupId,
  setSelectedGroupId
}){
  const [cameraName, setCameraName] = useState("");
  const [input, setInput]           = useState("");
  const [items, setItems]           = useState([]);
  const [error, setError]           = useState("");
  const [alertMsg, setAlertMsg]     = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleAdd = () => {
    if (!input.trim()) {
      setError("Please enter a stream URL");
      setAlertMsg("Stream URL is a mandatory field. Please enter a valid URL!");
      return;
    }
    if (!validateURL(input)) {
      setError("URL must start with rtsp://, rtsps://, http://, or https://");
      setAlertMsg("Stream URL is a mandatory field. Please enter a valid URL! (must start with rtsp://, rtsps://, http://, or https://)");
      return;
    }
    const trimmedUrl = input.trim();
    const trimmedName = cameraName.trim();
    if (items.some(it => it.url === trimmedUrl)) {
      setError("This URL is already added");
      return;
    }

    setItems((s) => [...s, { name: trimmedName, url: trimmedUrl }]);
    setInput("");
    setCameraName("");
    setError("");
    setAlertMsg("");
  };

  const handleRemove = (url) => setItems((s) => s.filter((it) => it.url !== url));

  const handleKeyDown = (e) => { if (e.key === "Enter") handleAdd(); };

  const handleSubmit = () => {
    if (items.length === 0) { setError("Add at least one stream URL"); return; }
    onAdd?.({ items, group_id: selectedGroupId });
    onClose?.();
  };

  return (
    <>
      <style>{css}</style>
      <div className="sum-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
        <div className="sum-card">

          {/* Header */}
          <div className="sum-header">
            <div>
              <div className="sum-eyebrow">Stream Ingestion</div>
              <h2 className="sum-title">Enter Stream URLs</h2>
            </div>
            <button className="sum-close" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="sum-body">
            {alertMsg && (
              <div className="sum-ui-alert">
                <svg className="sum-ui-alert-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div className="sum-ui-alert-text">{alertMsg}</div>
                <button className="sum-ui-alert-close" onClick={() => setAlertMsg("")}>✕</button>
              </div>
            )}

            {/* Camera Name */}
            <div className="sum-field">
              <label className="sum-label">
                CAMERA NAME <span style={{ textTransform: "none", opacity: 0.7 }}>(OPTIONAL)</span>
              </label>
              <input
                className="sum-input"
                placeholder="e.g. Parking Lot Camera"
                value={cameraName}
                onChange={(e) => setCameraName(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>

            {/* Group */}
            <div className="sum-field">
              <label className="sum-label">SELECT GROUP</label>
              <div className="sum-custom-select" ref={dropdownRef}>
                <button
                  type="button"
                  className="sum-select-btn"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <span>{selectedGroupId === "default" ? "Default" : groups?.find(g => g.id === selectedGroupId)?.name || "Default"}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255, 255, 255, 0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dropdownOpen ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}>
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </button>

                {dropdownOpen && (
                  <ul className="sum-dropdown-menu">
                    <li
                      className={`sum-dropdown-item ${selectedGroupId === "default" ? "active" : ""}`}
                      onClick={() => { setSelectedGroupId("default"); setDropdownOpen(false); }}
                    >
                      Default
                    </li>
                    {groups?.map((g) => (
                      <li
                        key={g.id}
                        className={`sum-dropdown-item ${selectedGroupId === g.id ? "active" : ""}`}
                        onClick={() => { setSelectedGroupId(g.id); setDropdownOpen(false); }}
                      >
                        {g.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Input + Add */}
            <div className="sum-field">
              <label className="sum-label">Stream URL <span style={{ color: "#f87171", marginLeft: "2px" }}>*</span></label>
              <div className="sum-add-row">
                <input
                  className={`sum-input ${error ? "error" : ""}`}
                  placeholder="rtsp://192.168.1.64:554/stream1"
                  value={input}
                  onChange={(e) => { setInput(e.target.value); setError(""); }}
                  onKeyDown={handleKeyDown}
                />
                <button className="sum-btn-add" onClick={handleAdd}>+ Add</button>
              </div>
              {error && <span className="sum-error-msg">{error}</span>}
            </div>

            {/* Items list */}
            {items.length > 0 && (
              <div className="sum-field">
                <label className="sum-label">{items.length} Stream{items.length > 1 ? "s" : ""} added</label>
                <div className="sum-url-list">
                  {items.map((it) => (
                    <div key={it.url} className="sum-url-item" style={{ gap: "10px" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" style={{ flexShrink: 0, marginTop: "2px" }}>
                        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                      </svg>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                        {it.name && (
                          <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {it.name}
                          </span>
                        )}
                        <span className="sum-url-text" style={{ fontSize: "12px", opacity: 0.8 }}>{it.url}</span>
                      </div>
                      <button className="sum-url-remove" onClick={() => handleRemove(it.url)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sum-footer">
            <button className="sum-btn sum-btn--ghost" onClick={onClose}>Cancel</button>
            <button
              className="sum-btn sum-btn--primary"
              onClick={() => {
                if (items.length === 0) {
                  if (input.trim()) {
                    setAlertMsg("Please click the '+ Add' button to add your entered Stream URL first!");
                  } 
                  setError("Add at least one stream URL");
                  return;
                }
                setAlertMsg("");
                handleSubmit();
              }}
            >
              Add {items.length > 0 ? `${items.length} ` : ""}Stream{items.length > 1 ? "s" : ""}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}