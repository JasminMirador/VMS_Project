import { useState, useEffect } from "react";
import Button from "../../components/shared/Button";
import Toggle from "../../components/shared/Toggle";
import SearchBar from "../../components/shared/SearchBar";
import "./Actionrulespage.css";

const SCHEDULES = ["Always", "Always on", "Office Hours", "Weekends", "Never"];

// Non-analytics triggers (always available regardless of camera)
const GENERIC_TRIGGER_LIST = [
  { type: "Motion detection",        desc: "This type occurs when a camera detects motion within its defined area. The detection is performed by the camera which means that no processing load is added to the server." },
  { type: "Active Tampering Alarm",  desc: "Triggered when camera tampering is detected, such as blocking or defocusing the lens." },
  { type: "AXIS Cross Line Detection", desc: "Triggered when an object crosses a defined virtual line in the camera view." },
  { type: "OccupancyCount",          desc: "Triggered based on the number of people/objects in a defined zone." },
  { type: "System Event and Error",  desc: "Triggered by system-level events such as storage failures or network issues." },
  { type: "Always active",           desc: "This trigger is always active and will continuously fire the associated actions." },
  { type: "Input/Output",            desc: "Triggered by digital input/output signals connected to the camera or server." },
  { type: "Device Event",            desc: "Triggered by events generated directly by the device firmware." },
  { type: "Action Button",           desc: "Triggered when a user manually presses an action button in the interface." },
  { type: "External HTTPS",          desc: "Triggered by an external HTTPS request sent to the server API." },
];

const ACTION_LIST = [
  { type: "Raise alarm",         desc: "Raises an alarm in the system that can be acknowledged by an operator." },
  { type: "Send email",          desc: "Sends an email notification with optional snapshot attachment." },
  { type: "Save recording",      desc: "Saves a video recording clip to the configured storage location." },
  { type: "Send notification",   desc: "Sends a push notification to connected clients." },
  { type: "Activate output",     desc: "Activates a digital output port on the camera or I/O device." },
  { type: "PTZ preset",          desc: "Moves a PTZ camera to a saved preset position." },
];

const STEPS = ["Triggers", "Actions", "Schedule", "Details"];

const EMPTY_RULE = {
  name: "", deviceId: "", allTriggers: false,
  triggers: [], actions: [], schedule: "Always on",
  actionLabel: "", enabled: true,
};

function loadDevices() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}
function loadRules() {
  try { return JSON.parse(localStorage.getItem("miradorai_action_rules") || "[]"); }
  catch { return []; }
}
function saveRules(rules) {
  try { localStorage.setItem("miradorai_action_rules", JSON.stringify(rules)); }
  catch {}
}

// ── Fetch built-in analytics for a camera from MQTT logs ──────────
// Calls GET /api/camera-analytics/:deviceId
// Backend should return { analytics: [ { type, scenario, description } ] }
// If no MQTT logs for that camera serial/ip → return { analytics: [] }
async function fetchCameraAnalytics(deviceId) {
  if (!deviceId) return { analytics: [], noSupport: false };
  try {
    const res = await fetch(`/api/camera-analytics/${deviceId}`);
    if (!res.ok) return { analytics: [], noSupport: true };
    const data = await res.json();
    if (!data.analytics || data.analytics.length === 0) {
      return { analytics: [], noSupport: true };
    }
    return { analytics: data.analytics, noSupport: false };
  } catch {
    return { analytics: [], noSupport: true };
  }
}

/* ── Add Trigger Sub-Modal ─────────────────────────────────── */
function AddTriggerModal({ deviceId, onAdd, onClose }) {
  const [sel, setSel] = useState(null);
  const [builtinAnalytics, setBuiltinAnalytics] = useState([]);
  const [noBuiltinSupport, setNoBuiltinSupport] = useState(false);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [activeTab, setActiveTab] = useState("generic"); // "generic" | "builtin"

  // Combined trigger list shown in left panel based on active tab
  const displayList = activeTab === "builtin" ? builtinAnalytics : GENERIC_TRIGGER_LIST;

  useEffect(() => {
    if (!deviceId) return;
    setLoadingAnalytics(true);
    fetchCameraAnalytics(deviceId).then(({ analytics, noSupport }) => {
      setBuiltinAnalytics(analytics);
      setNoBuiltinSupport(noSupport);
      setLoadingAnalytics(false);
    });
  }, [deviceId]);

  // Auto-select first item when tab or list changes
  useEffect(() => {
    if (displayList.length > 0) {
      setSel(displayList[0].type);
    } else {
      setSel(null);
    }
  }, [activeTab, builtinAnalytics]);

  const selectedDesc = displayList.find((t) => t.type === sel)?.desc
    || displayList.find((t) => t.type === sel)?.description
    || "";

  const handleOk = () => {
    if (!sel) return;
    // Tag built-in analytics triggers so alerts page can filter by them
    const isBuiltin = activeTab === "builtin";
    onAdd(sel, isBuiltin);
    onClose();
  };

  return (
    <div className="ar-modal-overlay ar-modal-overlay--top" onClick={onClose}>
      <div className="ar-sub-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ar-modal__header">
          <span>Add Trigger</span>
          <button className="ar-modal__close" onClick={onClose}>✕</button>
        </div>

        {/* Tab bar — only show Built-in tab if a device is selected */}
        <div className="ar-sub-modal__tabs">
          <button
            className={`ar-sub-modal__tab ${activeTab === "generic" ? "ar-sub-modal__tab--active" : ""}`}
            onClick={() => setActiveTab("generic")}
          >
            Standard Triggers
          </button>
          {deviceId && (
            <button
              className={`ar-sub-modal__tab ${activeTab === "builtin" ? "ar-sub-modal__tab--active" : ""}`}
              onClick={() => setActiveTab("builtin")}
            >
              Built-in Analytics
              {!loadingAnalytics && builtinAnalytics.length > 0 && (
                <span className="ar-sub-modal__tab-badge">{builtinAnalytics.length}</span>
              )}
            </button>
          )}
        </div>

        <div className="ar-sub-modal__body">
          <div className="ar-sub-modal__left">
            <div className="ar-sub-modal__section">
              {activeTab === "builtin" ? "Analytics" : "Trigger"}
            </div>

            {/* Loading state */}
            {activeTab === "builtin" && loadingAnalytics && (
              <div className="ar-sub-modal__loading">
                <div className="ar-sub-modal__spinner" />
                <span>Checking camera analytics…</span>
              </div>
            )}

            {/* No built-in support */}
            {activeTab === "builtin" && !loadingAnalytics && noBuiltinSupport && (
              <div className="ar-sub-modal__no-analytics">
                <div className="ar-sub-modal__no-analytics-icon">⚠</div>
                <div className="ar-sub-modal__no-analytics-title">No Built-in Analytics Supported</div>
                <div className="ar-sub-modal__no-analytics-desc">
                  This camera has not reported any analytics events via MQTT. 
                  Use Standard Triggers instead.
                </div>
              </div>
            )}

            {/* List of analytics/triggers */}
            {!(activeTab === "builtin" && (loadingAnalytics || noBuiltinSupport)) &&
              displayList.map((t) => (
                <div
                  key={t.type}
                  className={`ar-sub-modal__item ${sel === t.type ? "ar-sub-modal__item--active" : ""}`}
                  onClick={() => setSel(t.type)}
                >
                  {activeTab === "builtin" && (
                    <span className="ar-sub-modal__item-badge">MQTT</span>
                  )}
                  {t.type}
                </div>
              ))
            }
          </div>

          <div className="ar-sub-modal__right">
            <div className="ar-sub-modal__section">Description</div>
            {activeTab === "builtin" && !loadingAnalytics && noBuiltinSupport ? (
              <p className="ar-sub-modal__desc ar-sub-modal__desc--warn">
                Switch to <strong>Standard Triggers</strong> to configure triggers for this camera.
              </p>
            ) : (
              <p className="ar-sub-modal__desc">{selectedDesc}</p>
            )}
          </div>
        </div>

        <div className="ar-sub-modal__footer">
          <Button label="Help" onClick={() => {}} />
          <div className="ar-wizard__footer-right">
            <Button
              label="OK"
              variant="primary"
              disabled={!sel || (activeTab === "builtin" && (loadingAnalytics || noBuiltinSupport))}
              onClick={handleOk}
            />
            <Button label="Cancel" onClick={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Add Action Sub-Modal ──────────────────────────────────── */
function AddActionModal({ onAdd, onClose }) {
  const [sel, setSel] = useState(ACTION_LIST[0].type);
  const desc = ACTION_LIST.find((a) => a.type === sel)?.desc || "";

  return (
    <div className="ar-modal-overlay ar-modal-overlay--top" onClick={onClose}>
      <div className="ar-sub-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ar-modal__header">
          <span>Add Action</span>
          <button className="ar-modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="ar-sub-modal__body">
          <div className="ar-sub-modal__left">
            <div className="ar-sub-modal__section">Action</div>
            {ACTION_LIST.map((a) => (
              <div key={a.type}
                className={`ar-sub-modal__item ${sel === a.type ? "ar-sub-modal__item--active" : ""}`}
                onClick={() => setSel(a.type)}>
                {a.type}
              </div>
            ))}
          </div>
          <div className="ar-sub-modal__right">
            <div className="ar-sub-modal__section">Description</div>
            <p className="ar-sub-modal__desc">{desc}</p>
          </div>
        </div>
        <div className="ar-sub-modal__footer">
          <Button label="Help" onClick={() => {}} />
          <div className="ar-wizard__footer-right">
            <Button label="OK" variant="primary" onClick={() => { onAdd(sel); onClose(); }} />
            <Button label="Cancel" onClick={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Step: Triggers ────────────────────────────────────────── */
function StepTriggers({ form, setForm, devices }) {
  const [showAdd, setShowAdd] = useState(false);
  // Track which device is selected for the *next* trigger to be added
  const [pendingDeviceId, setPendingDeviceId] = useState(
    form.triggers[0]?.deviceId || devices[0]?.id || ""
  );

  const s = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const addTrigger = (type, isBuiltin = false) =>
    s("triggers", [...form.triggers, { type, deviceId: pendingDeviceId, isBuiltin }]);

  const removeTrigger = (i) =>
    s("triggers", form.triggers.filter((_, idx) => idx !== i));

  const editTrigger = (i, key, val) =>
    s("triggers", form.triggers.map((t, idx) => idx === i ? { ...t, [key]: val } : t));

  return (
    <div className="ar-step">
      <h3 className="ar-step__title">Triggers</h3>
      <p className="ar-step__desc">Triggers describe when a rule should become active.</p>
      <label className="ar-checkbox-row ar-checkbox-row--sm">
        <input type="checkbox" checked={form.allTriggers}
          onChange={(e) => s("allTriggers", e.target.checked)} />
        <span>All triggers must be active simultaneously to trigger the actions</span>
      </label>

      {/* Camera selector — picked BEFORE clicking Add, so analytics load correctly */}
      <div className="ar-step__device-select">
        <label className="ar-step__device-label">Camera for next trigger:</label>
        <select
          className="ar-select"
          value={pendingDeviceId}
          onChange={(e) => setPendingDeviceId(e.target.value)}
        >
          <option value="">— Select camera —</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <div className="ar-step__split">
        {/* Trigger list */}
        <div className="ar-step__list-box">
          {form.triggers.length === 0
            ? <div className="ar-step__list-empty">No triggers added yet.</div>
            : form.triggers.map((t, i) => {
              const dev = devices.find((d) => String(d.id) === String(t.deviceId));
              return (
                <div key={i} className="ar-step__list-item">
                  {t.isBuiltin && <span className="ar-card__hint-badge">MQTT</span>}
                  <span className="ar-step__list-item-type">{t.type}</span>
                  <span className="ar-step__list-item-on">on</span>
                  <select
                    className="ar-select ar-select--sm"
                    value={t.deviceId}
                    onChange={(e) => editTrigger(i, "deviceId", e.target.value)}
                  >
                    <option value="">— device —</option>
                    {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button
                    className="ar-step__list-remove"
                    onClick={() => removeTrigger(i)}
                    title="Remove trigger"
                  >✕</button>
                </div>
              );
            })}
        </div>

        {/* Buttons */}
        <div className="ar-step__list-btns">
          <Button label="Add..." onClick={() => setShowAdd(true)} />
          <Button label="Remove" disabled={form.triggers.length === 0}
            onClick={() => removeTrigger(form.triggers.length - 1)} />
        </div>
      </div>

      {showAdd && (
        <AddTriggerModal
          deviceId={pendingDeviceId}
          onAdd={addTrigger}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

/* ── Step: Actions ─────────────────────────────────────────── */
function StepActions({ form, setForm }) {
  const [showAdd, setShowAdd] = useState(false);
  const s = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const addAction = (type) =>
    s("actions", [...form.actions, { type, label: "" }]);
  const removeAction = (i) =>
    s("actions", form.actions.filter((_, idx) => idx !== i));
  const editAction = (i, key, val) =>
    s("actions", form.actions.map((a, idx) => idx === i ? { ...a, [key]: val } : a));

  return (
    <div className="ar-step">
      <h3 className="ar-step__title">Actions</h3>
      <p className="ar-step__desc">Actions are performed when all conditions are met.</p>

      <div className="ar-step__split">
        <div className="ar-step__list-box">
          {form.actions.length === 0
            ? <div className="ar-step__list-empty">No actions added yet.</div>
            : form.actions.map((a, i) => (
              <div key={i} className="ar-step__list-item">
                <span className="ar-step__list-item-type">{a.type}</span>
                <input className="ar-input ar-input--sm" value={a.label}
                  placeholder="label / message…"
                  onChange={(e) => editAction(i, "label", e.target.value)} />
              </div>
            ))}
        </div>
        <div className="ar-step__list-btns">
          <Button label="Add..." onClick={() => setShowAdd(true)} />
          <Button label="Edit..." disabled={form.actions.length === 0} onClick={() => {}} />
          <Button label="Remove" disabled={form.actions.length === 0}
            onClick={() => removeAction(form.actions.length - 1)} />
        </div>
      </div>

      {showAdd && (
        <AddActionModal
          onAdd={addAction}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

/* ── Step: Schedule ────────────────────────────────────────── */
function StepSchedule({ form, setForm }) {
  const s = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="ar-step">
      <h3 className="ar-step__title">Schedule</h3>
      <p className="ar-step__desc">Choose when this rule should be active.</p>
      <div className="ar-modal__field">
        <label>Schedule</label>
        <select className="ar-select" value={form.schedule}
          onChange={(e) => s("schedule", e.target.value)}>
          {SCHEDULES.map((sc) => <option key={sc}>{sc}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ── Step: Details ─────────────────────────────────────────── */
function StepDetails({ form, setForm, devices }) {
  const s = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="ar-step">
      <h3 className="ar-step__title">Details</h3>
      <p className="ar-step__desc">Give this rule a name to identify it.</p>
      <div className="ar-modal__field">
        <label>Rule name</label>
        <input className="ar-input" value={form.name}
          onChange={(e) => s("name", e.target.value)}
          placeholder="e.g. Motion detected…" />
      </div>
      <div className="ar-modal__field" style={{ marginTop: 12 }}>
        <label>Primary device</label>
        <select className="ar-select" value={form.deviceId}
          onChange={(e) => s("deviceId", e.target.value)}>
          <option value="">— Select device —</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ── Wizard Modal ──────────────────────────────────────────── */
function WizardModal({ initialRule, devices, onSave, onClose }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialRule ?? { ...EMPTY_RULE, id: Date.now() });

  const isLast    = step === STEPS.length - 1;
  const canFinish = isLast && form.name.trim() !== "";

  const handleFinish = () => {
    const trigger     = form.triggers[0]?.type    ?? "Motion detection";
    const actionLabel = form.actions[0]?.label     ?? "";
    const action      = form.actions[0]?.type      ?? "Raise alarm";
    const deviceId    = form.triggers[0]?.deviceId || form.deviceId || "";
    // Collect all builtin analytics trigger types for this rule for alert filtering
    const builtinTriggerTypes = form.triggers
      .filter((t) => t.isBuiltin)
      .map((t) => t.type);
    onSave({ ...form, trigger, action, actionLabel, deviceId, builtinTriggerTypes });
  };

  const stepContent = [
    <StepTriggers key="t" form={form} setForm={setForm} devices={devices} />,
    <StepActions  key="a" form={form} setForm={setForm} />,
    <StepSchedule key="s" form={form} setForm={setForm} />,
    <StepDetails  key="d" form={form} setForm={setForm} devices={devices} />,
  ];

  return (
    <div className="ar-modal-overlay" onClick={onClose}>
      <div className="ar-wizard" onClick={(e) => e.stopPropagation()}>
        <div className="ar-wizard__header">
          <span>{initialRule ? "Edit Rule" : "New Rule"}</span>
          <button className="ar-modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="ar-wizard__body">
          <div className="ar-wizard__sidebar">
            <div className="ar-wizard__sidebar-label">Steps</div>
            {STEPS.map((label, i) => (
              <div key={label}
                className={`ar-wizard__step-item
                  ${i === step ? " ar-wizard__step-item--active" : ""}
                  ${i < step   ? " ar-wizard__step-item--done"   : ""}`}
                onClick={() => setStep(i)}>
                {label}
              </div>
            ))}
          </div>

          <div className="ar-wizard__content">
            {stepContent[step]}
          </div>
        </div>

        <div className="ar-wizard__footer">
          <Button label="Help" onClick={() => {}} />
          <div className="ar-wizard__footer-right">
            <Button label="Cancel"  onClick={onClose} />
            <Button label="< Back"  disabled={step === 0}  onClick={() => setStep((s) => s - 1)} />
            <Button label="Next >"  disabled={isLast}       onClick={() => setStep((s) => s + 1)} />
            <Button label="Finish"  variant="primary" disabled={!canFinish} onClick={handleFinish} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Rule Card ─────────────────────────────────────────────── */
function RuleCard({ rule, devices, selected, onSelect, onToggle }) {
  const device     = devices.find((d) => String(d.id) === String(rule.deviceId));
  const deviceName = device?.name ?? "Unknown device";
  const actionText = rule.actionLabel
    ? `${rule.action} '${rule.actionLabel}'`
    : rule.action;
  const hasBuiltin = rule.builtinTriggerTypes?.length > 0;

  return (
    <div className={`ar-card${selected ? " ar-card--selected" : ""}`} onClick={onSelect}>
      <div className="ar-card__top">
        <span className="ar-card__name">{rule.name || "Unnamed Rule"}</span>
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle value={rule.enabled} onChange={onToggle} />
        </div>
      </div>
      <div className="ar-card__meta">
        {rule.allTriggers && (
          <span className="ar-card__hint">
            All triggers must be active simultaneously to trigger the actions
          </span>
        )}
        {hasBuiltin && (
          <span className="ar-card__hint ar-card__hint--builtin">
            ⚡ Built-in Analytics: {rule.builtinTriggerTypes.join(", ")}
          </span>
        )}
        <div className="ar-card__row">
          <span className="ar-card__key">Triggers:</span>
          <span className="ar-card__val">{rule.trigger} on '{deviceName}'</span>
        </div>
        <div className="ar-card__row">
          <span className="ar-card__key">Schedule:</span>
          <span className="ar-card__val">{rule.schedule}</span>
        </div>
        <div className="ar-card__row">
          <span className="ar-card__key">Actions:</span>
          <span className="ar-card__val">{actionText}</span>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────── */
export default function ActionRulesPage() {
  const [filter,     setFilter]     = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [rules,      setRules]      = useState(loadRules);
  const [modal,      setModal]      = useState(null);

  const devices  = loadDevices();
  const filtered = rules.filter((r) => {
    if (!filter) return true;
    const device = devices.find((d) => String(d.id) === String(r.deviceId));
    return [r.name, r.trigger, r.schedule, r.action, r.actionLabel, device?.name]
      .filter(Boolean).some((v) => v.toLowerCase().includes(filter.toLowerCase()));
  });

  const selected = rules.find((r) => r.id === selectedId) ?? null;
  const persist  = (updated) => { setRules(updated); saveRules(updated); };

  const handleSave = (form) => {
    persist(modal === "edit"
      ? rules.map((r) => r.id === form.id ? form : r)
      : [...rules, { ...form, id: Date.now() }]);
    setModal(null);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Action <span>Rules</span></h1>
          <p className="page-desc">Create and edit action rules by selecting triggers, actions, and schedules.</p>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Type to filter" />
      </div>

      <div className="ar-list">
        {filtered.length === 0
          ? <div className="ar-list__empty">No action rules defined. Click New… to create one.</div>
          : filtered.map((rule) => (
            <RuleCard key={rule.id} rule={rule} devices={devices}
              selected={rule.id === selectedId}
              onSelect={() => setSelectedId(rule.id === selectedId ? null : rule.id)}
              onToggle={(v) => persist(rules.map((r) => r.id === rule.id ? { ...r, enabled: v } : r))}
            />
          ))}
      </div>

      <div className="ar-footer">
        <Button label="New…"   variant="primary" onClick={() => setModal("new")} />
        <Button label="Edit…"  disabled={!selectedId} onClick={() => setModal("edit")} />
        <Button label="Copy…"  disabled={!selectedId} onClick={() => {
          if (selected) persist([...rules, { ...selected, id: Date.now(), name: `${selected.name} (copy)` }]);
        }} />
        <Button label="Remove" disabled={!selectedId} onClick={() => {
          persist(rules.filter((r) => r.id !== selectedId));
          setSelectedId(null);
        }} />
      </div>

      {(modal === "new" || modal === "edit") && (
        <WizardModal
          initialRule={modal === "edit" ? selected : null}
          devices={devices}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}