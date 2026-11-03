import React, { useState, useEffect } from "react";
import axios from "axios";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";
import "./CameraHistoryReport.css";
import { apiUrl } from "../../config/appConfig";

// Assuming API base is window.location.hostname for now, or using a generic approach:

export default function CameraHistoryReport() {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  
  const [toDate, setToDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });

  const [reportData, setReportData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  
  const [expandedRow, setExpandedRow] = useState(null);

  const fetchReport = async () => {
    setIsLoading(true);
    setError("");
    try {
      const fromIso = new Date(`${fromDate}T00:00:00Z`).toISOString();
      const toIso = new Date(`${toDate}T23:59:59Z`).toISOString();
      
      const res = await axios.get(apiUrl('/reports/history'), {
        params: { from_date: fromIso, to_date: toIso }
      });
      if (res.data.status === "success") {
        setReportData(res.data.data);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to fetch report data. Please ensure the backend is running.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const exportToPDF = () => {
    const doc = new jsPDF();
    doc.text(`Camera & Recording History (${fromDate} to ${toDate})`, 14, 15);
    
    const tableColumn = ["Camera Name", "IP", "Cam Up (hrs)", "Cam Down (hrs)", "Rec Up (hrs)", "Rec Down (hrs)"];
    const tableRows = reportData.map(row => [
      row.name,
      row.ip,
      row.camera_hours_up.toFixed(2),
      row.camera_hours_down.toFixed(2),
      row.recording_hours_up.toFixed(2),
      row.recording_hours_down.toFixed(2)
    ]);

    doc.autoTable({
      head: [tableColumn],
      body: tableRows,
      startY: 20,
    });
    doc.save(`Camera_History_Report_${fromDate}_${toDate}.pdf`);
  };

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(reportData.map(row => ({
      "Camera Name": row.name,
      "IP Address": row.ip,
      "Camera Up (hrs)": row.camera_hours_up,
      "Camera Down (hrs)": row.camera_hours_down,
      "Recording Up (hrs)": row.recording_hours_up,
      "Recording Down (hrs)": row.recording_hours_down
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");
    XLSX.writeFile(wb, `Camera_History_Report_${fromDate}_${toDate}.xlsx`);
  };

  const exportToCSV = () => {
    const headers = ["Camera Name", "IP Address", "Camera Up (hrs)", "Camera Down (hrs)", "Recording Up (hrs)", "Recording Down (hrs)"];
    const rows = reportData.map(row => [
      row.name,
      row.ip,
      row.camera_hours_up,
      row.camera_hours_down,
      row.recording_hours_up,
      row.recording_hours_down
    ]);
    
    let csvContent = headers.join(",") + "\n";
    rows.forEach(rowArray => {
      let row = rowArray.join(",");
      csvContent += row + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `Camera_History_Report_${fromDate}_${toDate}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const toggleRow = (ip) => {
    setExpandedRow(expandedRow === ip ? null : ip);
  };

  return (
    <div className="page-shell camera-history-shell">
      <div className="page-header">
        <h1 className="page-title">
          Camera <span>History Report</span>
        </h1>
        <div className="header-actions">
          <button className="btn-export" onClick={exportToPDF}>PDF</button>
          <button className="btn-export" onClick={exportToExcel}>Excel</button>
          <button className="btn-export" onClick={exportToCSV}>CSV</button>
        </div>
      </div>

      <div className="report-controls card">
        <div className="date-picker-group">
          <label>From Date:</label>
          <input 
            type="date" 
            value={fromDate} 
            onChange={e => setFromDate(e.target.value)} 
          />
        </div>
        <div className="date-picker-group">
          <label>To Date:</label>
          <input 
            type="date" 
            value={toDate} 
            onChange={e => setToDate(e.target.value)} 
          />
        </div>
        <button className="btn-primary" onClick={fetchReport} disabled={isLoading}>
          {isLoading ? "Fetching..." : "Generate Report"}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="report-table-container card">
        <table className="vms-table">
          <thead>
            <tr>
              <th>Camera Name</th>
              <th>IP Address</th>
              <th>Cam Up (hrs)</th>
              <th>Cam Down (hrs)</th>
              <th>Rec Up (hrs)</th>
              <th>Rec Down (hrs)</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {reportData.map((row) => (
              <React.Fragment key={row.ip}>
                <tr className={expandedRow === row.ip ? "expanded" : ""}>
                  <td>{row.name}</td>
                  <td>{row.ip}</td>
                  <td className="text-success">{row.camera_hours_up.toFixed(2)}</td>
                  <td className="text-danger">{row.camera_hours_down.toFixed(2)}</td>
                  <td className="text-success">{row.recording_hours_up.toFixed(2)}</td>
                  <td className="text-danger">{row.recording_hours_down.toFixed(2)}</td>
                  <td>
                    <button className="btn-details" onClick={() => toggleRow(row.ip)}>
                      {expandedRow === row.ip ? "Hide Events" : "View Events"}
                    </button>
                  </td>
                </tr>
                {expandedRow === row.ip && (
                  <tr className="events-row">
                    <td colSpan="7">
                      <div className="events-container">
                        <div className="events-column">
                          <h4>Camera Events</h4>
                          {row.camera_events.length === 0 ? <span className="text-muted">No events in this period.</span> : (
                            <ul>
                              {row.camera_events.map((e, idx) => (
                                <li key={idx}>
                                  <span className={`event-badge ${e.state.toLowerCase()}`}>{e.state}</span>
                                  {new Date(e.timestamp).toLocaleString()}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="events-column">
                          <h4>Recording Events</h4>
                          {row.recording_events.length === 0 ? <span className="text-muted">No events in this period.</span> : (
                            <ul>
                              {row.recording_events.map((e, idx) => (
                                <li key={idx}>
                                  <span className={`event-badge ${e.state.toLowerCase()}`}>{e.state}</span>
                                  {new Date(e.timestamp).toLocaleString()}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {reportData.length === 0 && !isLoading && (
              <tr>
                <td colSpan="7" className="text-center">No data available for the selected dates.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
