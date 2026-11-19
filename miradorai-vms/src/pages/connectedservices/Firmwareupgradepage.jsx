import { useState } from "react";
import Button from "../../components/shared/Button";
import "./Firmwareupgradepage.css";

const CHECK_INTERVALS = [
  "Every Start-Up",
  "Every Hour",
  "Every Day",
  "Every Week",
  "Never",
];

function Section({ title, subtitle, children }) {
  return (
    <div className="fu-section">
      <div className="fu-section__title">{title}</div>
      {subtitle && <p className="fu-section__subtitle">{subtitle}</p>}
      <div className="fu-section__body">{children}</div>
    </div>
  );
}

export default function FirmwareUpgradePage() {
  const [checkInterval,   setCheckInterval]   = useState("Every Start-Up");
  const [lastCheck]                           = useState("16-03-2026 09:31:02");
  const [upgradeOrder,    setUpgradeOrder]    = useState("parallel");
  const [cancelOnFail,    setCancelOnFail]    = useState(false);

  const handleCheckNow = () => {
    // Simulate a check — in production this would call an API
    alert("Checking for firmware updates…");
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <h1 className="page-title">Firmware upgrade <span>settings</span></h1>
        </div>
      </div>

      <div className="fu-body">

        {/* ── Automatic check for updates ── */}
        <Section
          title="Automatic check for updates"
          subtitle="MIRADOR VMS can automatically check for new firmware versions for your devices."
        >
          <div className="fu-row fu-row--inline">
            <span className="fu-label">Check for updates:</span>
            <select
              className="fu-select"
              value={checkInterval}
              onChange={(e) => setCheckInterval(e.target.value)}
            >
              {CHECK_INTERVALS.map((o) => <option key={o}>{o}</option>)}
            </select>
            <Button label="Check Now" onClick={handleCheckNow} />
          </div>
          <p className="fu-last-check">
            Latest check for updates: <span>{lastCheck}</span>
          </p>
        </Section>

        {/* ── Upgrade order ── */}
        <Section
          title="Upgrade order"
          subtitle="MIRADOR VMS can upgrade firmware for all the devices in parallel order, or upgrade one device at a time in a sequential order."
        >
          <label className="fu-radio">
            <input
              type="radio"
              name="upgrade-order"
              checked={upgradeOrder === "parallel"}
              onChange={() => setUpgradeOrder("parallel")}
            />
            <span>Parallel</span>
          </label>

          <label className="fu-radio">
            <input
              type="radio"
              name="upgrade-order"
              checked={upgradeOrder === "sequential"}
              onChange={() => setUpgradeOrder("sequential")}
            />
            <span>Sequential</span>
          </label>

          <label className={`fu-checkbox${upgradeOrder !== "sequential" ? " fu-checkbox--disabled" : ""}`}>
            <input
              type="checkbox"
              checked={cancelOnFail}
              disabled={upgradeOrder !== "sequential"}
              onChange={(e) => setCancelOnFail(e.target.checked)}
            />
            <span>Cancel all remaining upgrades if one device fails</span>
          </label>
        </Section>

      </div>

      {/* Footer */}
      <div className="page-footer">
        <span />
        <div className="page-footer-right">
          <Button label="Apply" variant="primary" onClick={() => {}} />
        </div>
      </div>
    </div>
  );
}