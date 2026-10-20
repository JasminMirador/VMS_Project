import { useEffect, useState } from "react";
import DataTable from "../../components/shared/DataTable";
import Button from "../../components/shared/Button";
import Toggle from "../../components/shared/Toggle";
import "./StorageSelectionPage.css";
const BACKEND =
  import.meta.env.VITE_API_URL ??
  `http://${import.meta.env.VITE_API_HOST}:${import.meta.env.VITE_API_PORT}`;

export default function StorageSelectionPage() {
  const [rows, setRows]         = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  // Panel state
  const [storeTo, setStoreTo]     = useState("C:\\Recording");
  const [retention, setRetention] = useState("limited");
  const [days, setDays]           = useState("70");
  const [failover, setFailover]   = useState(false);

  const fetchData = () => {
    fetch(`${BACKEND}/api/storage/selection`)
      .then(r => r.json())
      .then(data => {
        setRows(data.map((cam, i) => ({
          id: i,
          cells: [
            cam.device,
            cam.used_storage,
            cam.location,
            cam.retention === 0 ? "Unlimited" : `${cam.retention} days`,
            cam.oldest_recording,
            cam.failover ? "Yes" : "No",
          ],
          raw: cam,
        })));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  // When row selected, populate panel
  useEffect(() => {
    const sel = rows.find(r => r.id === selected)?.raw;
    if (sel) {
      setStoreTo(sel.location || "C:\\Recording");
      setDays(String(sel.retention || 70));
      setRetention(sel.retention === 0 ? "unlimited" : "limited");
      setFailover(sel.failover || false);
    }
  }, [selected]);

  const handleApply = async () => {
    const sel = rows.find(r => r.id === selected)?.raw;
    if (!sel) return;
    setSaving(true);
    await fetch(`${BACKEND}/api/storage/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ip: sel.ip,
        store_to: storeTo,
        retention_days: retention === "unlimited" ? 0 : parseInt(days) || 70,
        failover,
      }),
    });
    setSaving(false);
    fetchData();
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Storage <span>Selection</span></h1>
          <p className="page-desc">Assign recording destinations and configure retention policies per device.</p>
        </div>
      </div>

      <DataTable
        columns={["Device", "Used Storage", "Location", "Retention", "Oldest Recording", "Failover"]}
        rows={rows}
        selectedId={selected}
        onSelect={setSelected}
        emptyMessage={loading ? "Loading..." : "No devices configured."}
      />

      <div className="ss-panel card">
        <div className="ss-panel__title">
          Recording Storage Policy
          {selected !== null && (
            <span style={{ fontSize: 11, color: "var(--brand)", marginLeft: 8 }}>
              — {rows.find(r => r.id === selected)?.raw?.device}
            </span>
          )}
        </div>
        <div className="ss-grid">
          <div className="ss-field">
            <label>Store To</label>
            <select value={storeTo} onChange={e => setStoreTo(e.target.value)} className="ss-select">
              <option value="C:\\Recording">C:\Recording</option>
              <option value="local">Local Disk</option>
              <option value="nas">Network NAS</option>
            </select>
          </div>
          <div className="ss-field">
            <label>Retention Policy</label>
            <div className="ss-radios">
              {[["unlimited", "Unlimited"], ["limited", "Limited Duration"]].map(([v, l]) => (
                <label key={v} className="ss-radio">
                  <input type="radio" name="ret" checked={retention === v} onChange={() => setRetention(v)} />
                  {l}
                </label>
              ))}
              {retention === "limited" && (
                <div className="ss-days">
                  <input type="number" value={days} onChange={e => setDays(e.target.value)} placeholder="70" />
                  <span>days</span>
                </div>
              )}
            </div>
          </div>
          <div className="ss-field">
            <label>Failover Recording</label>
            <Toggle value={failover} onChange={setFailover} />
          </div>
        </div>
        <div className="ss-footer">
          <Button
            label={saving ? "Saving..." : "Apply Policy"}
            variant="primary"
            onClick={handleApply}
            disabled={selected === null || saving}
          />
        </div>
      </div>
    </div>
  );
}