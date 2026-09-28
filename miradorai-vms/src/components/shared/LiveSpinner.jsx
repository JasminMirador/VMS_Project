import { memo } from "react";

const CSS = `
@keyframes lvs-spin    { to { transform: rotate(360deg); } }
@keyframes lvs-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes lvs-pulse   { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }

.lvs-root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  overflow: hidden;
}
.lvs-shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 30%,
    rgba(148, 163, 184, 0.09) 50%,
    transparent 70%
  );
  background-size: 200% 100%;
  animation: lvs-shimmer 2.2s ease-in-out infinite;
}
.lvs-ring {
  position: relative;
  width: clamp(14px, 9cqmin, 32px);
  height: clamp(14px, 9cqmin, 32px);
  border-radius: 50%;
  border: 2px solid rgba(148, 163, 184, 0.22);
  border-top-color: var(--teal, #10b981);
  animation: lvs-spin 0.9s linear infinite;
}
.lvs-label {
  position: relative;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted, #64748b);
  animation: lvs-pulse 1.8s ease-in-out infinite;
}
@container (max-height: 130px) { .lvs-label { display: none; } }
@container (max-height: 60px)  { .lvs-ring  { border-width: 1.5px; } }
`;

if (typeof document !== "undefined" && !document.getElementById("lvs-styles")) {
  const el = document.createElement("style");
  el.id = "lvs-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}

function LiveSpinner({ label = "Connecting…" }) {
  return (
    <div className="lvs-root" role="status" aria-label={label}>
      <div className="lvs-shimmer" />
      <div className="lvs-ring" />
      <div className="lvs-label">{label}</div>
    </div>
  );
}

export default memo(LiveSpinner);