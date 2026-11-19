import { useState } from "react";
import Button from "../../components/shared/Button";
import SearchBar from "../../components/shared/SearchBar";
import "./Smartsearchsettingspage.css";

const DRIVES = ["C:\\", "D:\\", "E:\\"];

const DEFAULT_FOLDER = "ProgramData\\MIrador VMS\\Camera Station\\Component";

function loadDevices() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export default function SmartSearchSettingsPage() {
  const [camSearch,       setCamSearch]       = useState("");
  const [selectedCams,    setSelectedCams]    = useState({});
  const [bgClassify,      setBgClassify]      = useState({});

  // Storage location
  const [drive,           setDrive]           = useState("C:\\");
  const [folder,          setFolder]          = useState(DEFAULT_FOLDER);
  const [folderDraft,     setFolderDraft]      = useState(DEFAULT_FOLDER);

  // Storage size limit
  const [sizeLimit,       setSizeLimit]       = useState("");
  const [sizeDraft,       setSizeDraft]       = useState("");

  // Missing metadata
  const [includeMissing,  setIncludeMissing]  = useState(false);

  const devices = loadDevices();

  const allChecked = devices.length > 0 && devices.every((d) => selectedCams[d.id]);
  const someChecked = devices.some((d) => selectedCams[d.id]);

  const toggleAll = () => {
    if (allChecked) setSelectedCams({});
    else setSelectedCams(Object.fromEntries(devices.map((d) => [d.id, true])));
  };

  const toggleCam = (id) =>
    setSelectedCams((prev) => ({ ...prev, [id]: !prev[id] }));

  const toggleBg = (id) =>
    setBgClassify((prev) => ({ ...prev, [id]: !prev[id] }));

  const filtered = devices.filter((d) =>
    !camSearch || d.name?.toLowerCase().includes(camSearch.toLowerCase())
  );

  return (
    <div className="page-shell">
      {/* Info banner */}
      <div className="ss-banner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="ss-banner__icon">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 16v-4M12 8h.01"/>
        </svg>
        <span>
          Smart search 2 can affect system performance. Please read the MIRADOR VMS
          User Manual to learn more.
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="ss-banner__link-icon">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
        </svg>
      </div>

      <div className="ss-body">

        {/* ── Cameras ── */}
        <div className="ss-section">
          <div className="ss-section__header">
            <div>
              <div className="ss-section__title">Cameras</div>
              <p className="ss-section__desc">Select cameras to send analytics metadata to smart search 2.</p>
            </div>
            <SearchBar value={camSearch} onChange={setCamSearch} placeholder="Search cameras" />
          </div>

          <div className="ss-table-wrap">
            <table className="ss-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      className="ss-check"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }}
                      onChange={toggleAll}
                    />
                  </th>
                  <th style={{ width: 60 }}></th>
                  <th>Name</th>
                  <th>Metadata status</th>
                  <th style={{ width: 36 }}>
                    <span title="Background server classification">Background server classification</span>
                  </th>
                  <th></th>
                  <th>MAC address</th>
                  <th>Model</th>
                  <th style={{ width: 36 }}>Filter</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="ss-table__empty">
                      No cameras enrolled. Go to Add Devices first.
                    </td>
                  </tr>
                ) : filtered.map((d) => (
                  <tr key={d.id} className={selectedCams[d.id] ? "ss-row--selected" : ""}>
                    <td>
                      <input type="checkbox" className="ss-check"
                        checked={!!selectedCams[d.id]}
                        onChange={() => toggleCam(d.id)} />
                    </td>
                    <td>
                      {d.snapshot_url
                        ? <img src={d.snapshot_url} className="ss-thumb" alt="" />
                        : <div className="ss-thumb ss-thumb--placeholder">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M23 7l-7 5 7 5V7z"/>
                              <rect x="1" y="5" width="15" height="14" rx="2"/>
                            </svg>
                          </div>
                      }
                    </td>
                    <td>{d.name}</td>
                    <td>
                      <span className={`ss-status ${selectedCams[d.id] ? "ss-status--streaming" : "ss-status--idle"}`}>
                        {selectedCams[d.id] ? "Streaming" : "Idle"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" className="ss-check"
                        checked={!!bgClassify[d.id]}
                        onChange={() => toggleBg(d.id)} />
                    </td>
                    <td>
                      {bgClassify[d.id] && (
                        <span className="ss-allow-tag">Allow</span>
                      )}
                    </td>
                    <td className="ss-mono">{d.mac || "B8A44F931A59"}</td>
                    <td>{d.model || d.name}</td>
                    <td>
                      <button className="ss-gear-btn" title="Filter settings">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <circle cx="12" cy="12" r="3"/>
                          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Storage ── */}
        <div className="ss-section">
          <div className="ss-section__title">Storage</div>
          <p className="ss-section__desc">Configure smart search 2 storage settings.</p>

          {/* Storage location */}
          <div className="ss-subsection">
            <div className="ss-subsection__title">Storage location</div>
            <p className="ss-subsection__desc">Choose where you want to store the data.</p>
            <div className="ss-storage-row">
              <div className="ss-storage-col">
                <div className="ss-field-label">Drive</div>
                <select className="ss-select ss-select--drive" value={drive}
                  onChange={(e) => setDrive(e.target.value)}>
                  {DRIVES.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="ss-storage-col ss-storage-col--grow">
                <div className="ss-field-label">Folder</div>
                <input className="ss-input ss-input--path" value={folderDraft}
                  onChange={(e) => setFolderDraft(e.target.value)} />
              </div>
              <div className="ss-storage-col ss-storage-col--btns">
                <Button label="Apply" variant="primary"
                  disabled={folderDraft === folder}
                  onClick={() => setFolder(folderDraft)} />
                <Button label="Undo"
                  disabled={folderDraft === folder}
                  onClick={() => setFolderDraft(folder)} />
              </div>
            </div>
          </div>

          {/* Storage size limit */}
          <div className="ss-subsection">
            <div className="ss-subsection__title">Storage size limit</div>
            <p className="ss-subsection__desc">
              Limit the amount of used disk space. The oldest detections are removed when size is reached.
            </p>
            <p className="ss-current-size">Current storage size is approximately 0 GB.</p>
            <div className="ss-size-row">
              <div className="ss-field-label">Size</div>
              <div className="ss-size-input-wrap">
                <input className="ss-input ss-input--size" value={sizeDraft}
                  placeholder="No limit"
                  onChange={(e) => setSizeDraft(e.target.value)} />
                <span className="ss-size-unit">GB</span>
              </div>
              <Button label="Apply" variant="primary"
                disabled={sizeDraft === sizeLimit}
                onClick={() => setSizeLimit(sizeDraft)} />
              <Button label="Undo"
                disabled={sizeDraft === sizeLimit}
                onClick={() => setSizeDraft(sizeLimit)} />
            </div>
          </div>
        </div>

        {/* ── Missing metadata ── */}
        <div className="ss-section">
          <div className="ss-section__title">Missing metadata</div>
          <p className="ss-section__desc">
            Enable to include periods in the search result where the camera was disconnected
            and no metadata was recorded. Reasons can be network error, reboot, or because
            MIRADOR VMS was not running.
          </p>
          <label className="ss-checkbox-row">
            <input type="checkbox" className="ss-check"
              checked={includeMissing}
              onChange={(e) => setIncludeMissing(e.target.checked)} />
            <span>Include periods with missing metadata</span>
          </label>
        </div>

      </div>
    </div>
  );
}