import React, { useState, useMemo } from "react";

export function exportReportAsJSON(report, filename = "parts_report.json") {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportReportAsCSV(report, filename = "parts_report.csv") {
  if (!report || !report.parts) return;
  const headers = ["Name", "Layer", "Type", "Width_m", "Height_m", "Length_or_Depth_m", "CenterX", "CenterY"];
  const rows = report.parts.map(p => {
    const name = `"${(p.name || p.groupId || "unnamed").replace(/"/g, '""')}"`;
    const layer = `"${(p.layer || "").replace(/"/g, '""')}"`;
    const type = `"${(p.type || "").replace(/"/g, '""')}"`;
    const w = (p.dimensions?.width ?? 0).toFixed(4);
    const h = (p.dimensions?.height ?? 0).toFixed(4);
    const l = (p.length_m ?? p.dimensions?.depth ?? 0).toFixed(4);
    const cx = (p.worldCenter?.x ?? "").toString();
    const cy = (p.worldCenter?.y ?? "").toString();
    return [name, layer, type, w, h, l, cx, cy].join(",");
  });

  const csvContent = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PartsMeasurementPanel({ report, style = {}, filenamePrefix = "cad_parts" }) {
  const [collapsed, setCollapsed] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const parts = report?.parts || [];
  const totalCount = report?.totalRawParts || parts.length;

  const filteredParts = useMemo(() => {
    if (!searchTerm.trim()) return parts;
    const q = searchTerm.toLowerCase();
    return parts.filter(p =>
      (p.name || p.groupId || "").toLowerCase().includes(q) ||
      (p.layer || "").toLowerCase().includes(q) ||
      (p.type || "").toLowerCase().includes(q)
    );
  }, [parts, searchTerm]);

  if (!report || parts.length === 0) return null;

  return (
    <div
      className="mv-parts-panel"
      style={{
        position: "absolute",
        zIndex: 10,
        ...style
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontWeight: "700", color: "var(--teal, #10b981)" }}>
            Parts: {totalCount}
          </span>
          <span style={{ fontSize: "10px", color: "var(--text-muted, #94a3b8)" }}>
            ({report.strategy || "direct"})
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            type="button"
            className="mv-parts-btn"
            onClick={() => exportReportAsJSON(report, `${filenamePrefix}_report.json`)}
            title="Download full parts metadata as JSON"
          >
            JSON
          </button>
          <button
            type="button"
            className="mv-parts-btn"
            onClick={() => exportReportAsCSV(report, `${filenamePrefix}_report.csv`)}
            title="Download parts dimension table as CSV"
          >
            CSV
          </button>
          <button
            type="button"
            className="mv-parts-btn"
            onClick={() => setCollapsed(prev => !prev)}
            title={collapsed ? "Expand parts inspection table" : "Collapse table"}
          >
            {collapsed ? "▾ Expand" : "▴ Hide"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {report.warning && (
            <div style={{
              marginTop: "6px",
              padding: "4px 8px",
              background: "rgba(245, 158, 11, 0.15)",
              color: "#f59e0b",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              borderRadius: "4px",
              fontSize: "11px"
            }}>
              ⚠ {report.warning}
            </div>
          )}

          {/* Search bar */}
          <div style={{ marginTop: "8px", display: "flex", gap: "6px", alignItems: "center" }}>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search parts, layers, types..."
              style={{
                width: "100%",
                padding: "3px 8px",
                fontSize: "11px",
                borderRadius: "4px",
                border: "1px solid var(--border, rgba(255,255,255,0.15))",
                background: "var(--bg-elevated, rgba(0,0,0,0.25))",
                color: "var(--text-primary, #f8fafc)",
                outline: "none"
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted, #94a3b8)",
                  cursor: "pointer",
                  fontSize: "11px",
                  padding: "0 4px"
                }}
              >
                ✕
              </button>
            )}
          </div>

          <div style={{ maxHeight: "240px", overflowY: "auto", marginTop: "6px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr style={{ color: "var(--text-muted, #94a3b8)", borderBottom: "1px solid var(--border, rgba(255,255,255,0.15))" }}>
                  <th style={{ textAlign: "left", padding: "4px 6px 4px 0" }}>Name</th>
                  {parts[0]?.layer && <th style={{ textAlign: "left", padding: "4px 6px" }}>Layer</th>}
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>W (m)</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>H (m)</th>
                  <th style={{ padding: "4px 0 4px 6px", textAlign: "right" }}>L (m)</th>
                </tr>
              </thead>
              <tbody>
                {filteredParts.slice(0, 500).map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border-light, rgba(255,255,255,0.05))" }}>
                    <td
                      style={{
                        padding: "4px 6px 4px 0",
                        maxWidth: "130px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        color: "var(--text-primary, #f8fafc)"
                      }}
                      title={p.name || p.groupId}
                    >
                      {p.name || p.groupId}
                    </td>
                    {parts[0]?.layer && (
                      <td
                        style={{
                          padding: "4px 6px",
                          maxWidth: "80px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--text-muted, #94a3b8)",
                          fontSize: "10px"
                        }}
                        title={p.layer}
                      >
                        {p.layer}
                      </td>
                    )}
                    <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-secondary, #cbd5e1)" }}>
                      {(p.dimensions?.width ?? 0).toFixed(2)}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-secondary, #cbd5e1)" }}>
                      {(p.dimensions?.height ?? 0).toFixed(2)}
                    </td>
                    <td style={{ padding: "4px 0 4px 6px", textAlign: "right", color: "var(--text-secondary, #cbd5e1)" }}>
                      {(p.length_m ?? p.dimensions?.depth ?? 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredParts.length > 500 && (
              <div style={{ textAlign: "center", fontSize: "10px", color: "var(--text-muted, #94a3b8)", padding: "4px 0" }}>
                Showing 500 of {filteredParts.length} parts (export CSV/JSON for full list)
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}