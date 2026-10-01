import React, { useState, useEffect, useRef } from "react";
import { Mail, Trash2, Clock, Send, Paperclip, X, Calendar, Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, List, ListOrdered } from "lucide-react";
import "./EmailSchedulesPage.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

const getAuthHeaders = () => {
  const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
  return token ? { "Authorization": "Bearer " + token } : {};
};

const reportTypeMap = {
  alerts: "Camera Up/Down History",
  live_alerts: "Analytics Alerts",
  health: "Device Health & Uptime Status",
  camera_down: "Immediate Alert: Camera Down",
  storage_full: "Immediate Alert: Storage > 95%",
  recording_stopped: "Immediate Alert: Recording Stopped"
};

const TagInput = ({ tags, setTags, placeholder }) => {
  const [inputValue, setInputValue] = useState("");

  const handleKeyDown = (e) => {
    if (e.key === ',' || e.key === 'Enter') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  };

  const addTag = () => {
    const val = inputValue.trim().replace(/,$/, '');
    if (val && !tags.includes(val)) {
      setTags([...tags, val]);
    }
    setInputValue("");
  };

  const removeTag = (index) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  return (
    <div className="es-tag-input-container">
      {tags.map((tag, i) => (
        <div key={i} className={`es-tag es-tag-color-${i % 4}`}>
          <span className="es-tag-avatar">{tag.substring(0, 1).toUpperCase()}</span>
          <span className="es-tag-text">{tag}</span>
          <button type="button" className="es-tag-close" onClick={() => removeTag(i)}><X size={12} /></button>
        </div>
      ))}
      <input
        type="text"
        className="es-tag-input"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={tags.length === 0 ? placeholder : ""}
      />
    </div>
  );
};

const MultiSelectDropdown = ({ options, selected, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (val) => {
    if (selected.includes(val)) {
      onChange(selected.filter(item => item !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div className="es-multiselect" ref={dropdownRef} style={{ position: 'relative' }}>
      <div 
        className="es-select" 
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: 'pointer', minHeight: '38px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px', padding: '4px 8px' }}
      >
        {selected.length === 0 ? (
          <span style={{ color: '#888' }}>Select reports...</span>
        ) : (
          selected.map(val => {
            const opt = options.find(o => o.value === val);
            return (
              <span key={val} style={{ background: '#14b8a6', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>
                {opt ? opt.label : val}
              </span>
            );
          })
        )}
      </div>
      {isOpen && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', marginTop: '4px', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
          {options.map(opt => (
            <div 
              key={opt.value}
              onClick={(e) => {
                e.stopPropagation();
                toggleOption(opt.value);
              }}
              style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #334155' }}
            >
              <input 
                type="checkbox" 
                checked={selected.includes(opt.value)}
                readOnly
                style={{ cursor: 'pointer' }}
              />
              <span style={{ fontSize: '14px', color: '#f8fafc' }}>{opt.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const RichTextEditor = ({ value, onChange, placeholder }) => {
  const editorRef = useRef(null);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value && !isFocused) {
      editorRef.current.innerHTML = value;
    }
  }, [value, isFocused]);

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const execCmd = (e, cmd, arg = null) => {
    e.preventDefault();
    document.execCommand(cmd, false, arg);
    if (editorRef.current) editorRef.current.focus();
  };

  return (
    <div className={`es-rte-container ${isFocused ? 'focused' : ''}`}>
      <div className="es-rte-toolbar">
        <button type="button" onMouseDown={(e) => execCmd(e, 'bold')} title="Bold"><Bold size={14} /></button>
        <button type="button" onMouseDown={(e) => execCmd(e, 'italic')} title="Italic"><Italic size={14} /></button>
        <button type="button" onMouseDown={(e) => execCmd(e, 'underline')} title="Underline"><Underline size={14} /></button>
        <button type="button" onMouseDown={(e) => execCmd(e, 'strikeThrough')} title="Strikethrough"><Strikethrough size={14} /></button>
        <span className="es-rte-divider"></span>
        <button type="button" onMouseDown={(e) => execCmd(e, 'justifyLeft')} title="Align Left"><AlignLeft size={14} /></button>
        <button type="button" onMouseDown={(e) => execCmd(e, 'justifyCenter')} title="Align Center"><AlignCenter size={14} /></button>
        <button type="button" onMouseDown={(e) => execCmd(e, 'justifyRight')} title="Align Right"><AlignRight size={14} /></button>
        <span className="es-rte-divider"></span>
        <button type="button" onMouseDown={(e) => execCmd(e, 'insertUnorderedList')} title="Bullet List"><List size={14} /></button>
        <button type="button" onMouseDown={(e) => execCmd(e, 'insertOrderedList')} title="Numbered List"><ListOrdered size={14} /></button>
      </div>
      <div
        className="es-rte-content"
        contentEditable
        ref={editorRef}
        onInput={handleInput}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          handleInput();
        }}
        data-placeholder={value ? "" : placeholder}
      />
    </div>
  );
};

export default function EmailSchedulesPage() {
  const [activeTab, setActiveTab] = useState("schedules");
  
  // Schedules State
  const [schedules, setSchedules] = useState([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [scheduleRecipients, setScheduleRecipients] = useState([]);
  const [scheduleType, setScheduleType] = useState("daily");
  const [scheduleReportType, setScheduleReportType] = useState(["alerts"]);
  const [scheduleFormat, setScheduleFormat] = useState("pdf");
  const [scheduleSendTime, setScheduleSendTime] = useState("09:00");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleSubmitMsg, setScheduleSubmitMsg] = useState("");

  // Compose State
  const [composeTo, setComposeTo] = useState([]);
  const [composeCc, setComposeCc] = useState([]);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeFiles, setComposeFiles] = useState([]);
  const [composeSending, setComposeSending] = useState(false);
  const [composeMsg, setComposeMsg] = useState("");
  
  const [historyOpen, setHistoryOpen] = useState(false);
  const [emailHistory, setEmailHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchSchedules = async () => {
    setSchedulesLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reports/schedules`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSchedules(data.schedules || []);
        }
      }
    } catch (err) {
      console.error("Failed to fetch schedules:", err);
    } finally {
      setSchedulesLoading(false);
    }
  };

  const fetchEmailHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reports/manual-history`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setEmailHistory(data.history || []);
        }
      }
    } catch (err) {
      console.error("Failed to fetch email history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'compose' && historyOpen) {
      fetchEmailHistory();
    }
  }, [activeTab, historyOpen]);

  const handleAddSchedule = async (e) => {
    e.preventDefault();
    if (scheduleRecipients.length === 0) {
      setScheduleSubmitMsg("Please enter at least one recipient email address.");
      return;
    }
    setScheduleSubmitMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/reports/schedules`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          report_type: scheduleReportType.join(","),
          schedule_type: scheduleType,
          recipients: scheduleRecipients,
          format: scheduleFormat,
          send_time: scheduleSendTime,
          enabled: scheduleEnabled
        })
      });
      const data = await res.json();
      if (data.success) {
        setScheduleSubmitMsg("Schedule saved successfully!");
        setScheduleRecipients([]);
        fetchSchedules();
      } else {
        setScheduleSubmitMsg(`Error: ${data.error}`);
      }
    } catch (err) {
      setScheduleSubmitMsg("Failed to save schedule.");
    }
  };

  const handleDeleteSchedule = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/api/reports/schedules/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (data.success) {
        fetchSchedules();
      }
    } catch (err) {
      console.error("Failed to delete schedule:", err);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
      const validFiles = newFiles.filter(file => {
        if (file.size > MAX_FILE_SIZE) {
          alert(`File "${file.name}" exceeds the maximum allowed size of 5MB and will not be attached.`);
          return false;
        }
        return true;
      });
      setComposeFiles(prev => [...prev, ...validFiles]);
      e.target.value = "";
    }
  };

  const removeFile = (index) => {
    setComposeFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendManual = async (e) => {
    e.preventDefault();
    if (composeTo.length === 0) {
      setComposeMsg("Please enter at least one 'To' address.");
      return;
    }
    setComposeSending(true);
    setComposeMsg("");

    const formData = new FormData();
    formData.append("to", composeTo.join(","));
    if (composeCc.length > 0) formData.append("cc", composeCc.join(","));
    formData.append("subject", composeSubject);
    formData.append("body", composeBody);
    
    composeFiles.forEach(file => {
      formData.append("files", file);
    });

    try {
      const res = await fetch(`${API_BASE}/api/reports/send-manual`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setComposeMsg("Email sent successfully!");
        setComposeTo([]);
        setComposeCc([]);
        setComposeSubject("");
        setComposeBody("");
        setComposeFiles([]);
        if (historyOpen) fetchEmailHistory();
      } else {
        setComposeMsg(`Error: ${data.error}`);
      }
    } catch (err) {
      setComposeMsg("Failed to send email. Please check network.");
    } finally {
      setComposeSending(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  return (
    <div className="es-page">
      <div className="es-header-tabs">
        <h1 className="es-title">Email & Schedules</h1>
        <div className="es-tabs">
          <button 
            className={`es-tab-btn ${activeTab === 'schedules' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedules')}
          >
            <Calendar size={16} /> Automated Schedules
          </button>
          <button 
            className={`es-tab-btn ${activeTab === 'compose' ? 'active' : ''}`}
            onClick={() => setActiveTab('compose')}
          >
            <Send size={16} /> Compose Email
          </button>
        </div>
      </div>

      <div className="es-content-layout">
        {activeTab === 'schedules' && (
          <>
            <div className="es-panel es-form-panel">
              <form onSubmit={handleAddSchedule} className="es-form">
                <h5 className="es-form-title">
                  <Mail size={16} className="es-icon-teal" />
                  <span>Add Email Schedule</span>
                </h5>
                
                <div className="es-form-field">
                  <label>Recipient Email(s)</label>
                  <TagInput 
                    tags={scheduleRecipients} 
                    setTags={setScheduleRecipients} 
                    placeholder="e.g. admin@domain.com"
                  />
                  <span className="es-field-tip">Press enter or comma to add</span>
                </div>

                <div className="es-form-row">
                  <div className="es-form-field">
                    <label>Frequency / Trigger</label>
                    <select
                      value={scheduleType}
                      onChange={(e) => {
                        setScheduleType(e.target.value);
                        if (e.target.value === "immediate") {
                          setScheduleReportType(["camera_down"]);
                        } else if (scheduleReportType.some(r => ["camera_down", "storage_full", "recording_stopped"].includes(r))) {
                          setScheduleReportType(["alerts"]);
                        }
                      }}
                      className="es-select"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="immediate">Immediate (On Event)</option>
                    </select>
                  </div>
                  
                  <div className="es-form-field">
                    <label>Send Time</label>
                    <div className="es-time-input-wrapper">
                      <Clock size={14} className="es-time-icon" />
                      <input
                        type="time"
                        value={scheduleSendTime}
                        onChange={(e) => setScheduleSendTime(e.target.value)}
                        className="es-time-input"
                        disabled={scheduleType === "immediate"}
                        style={{ opacity: scheduleType === "immediate" ? 0.5 : 1 }}
                      />
                    </div>
                  </div>
                </div>

                <div className="es-form-row">
                  <div className="es-form-field">
                    <label>Report Type</label>
                    <MultiSelectDropdown
                      selected={scheduleReportType}
                      onChange={setScheduleReportType}
                      options={
                        scheduleType === "immediate"
                          ? [
                              { value: "camera_down", label: "Immediate Alert: Camera Down" },
                              { value: "storage_full", label: "Immediate Alert: Storage > 95%" },
                              { value: "recording_stopped", label: "Immediate Alert: Recording Stopped" }
                            ]
                          : [
                              { value: "alerts", label: "Camera Up/Down History" },
                              { value: "live_alerts", label: "Analytics Alerts" },
                              { value: "health", label: "Device Health & Uptime Status" }
                            ]
                      }
                    />
                  </div>

                  <div className="es-form-field">
                    <label>Attachment Format</label>
                    <select
                      value={scheduleFormat}
                      onChange={(e) => setScheduleFormat(e.target.value)}
                      className="es-select"
                      disabled={scheduleType === "immediate"}
                      style={{ opacity: scheduleType === "immediate" ? 0.5 : 1 }}
                    >
                      <option value="pdf">PDF</option>
                      <option value="xlsx">Excel (.xlsx)</option>
                      <option value="csv">CSV</option>
                    </select>
                  </div>
                </div>

                <div className="es-checkbox-field">
                  <input
                    type="checkbox"
                    id="scheduleEnabled"
                    checked={scheduleEnabled}
                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                    className="es-checkbox"
                  />
                  <label htmlFor="scheduleEnabled">Enable Schedule</label>
                </div>

                <button type="submit" className="es-btn-primary">
                  Save Schedule
                </button>

                {scheduleSubmitMsg && (
                  <div className={`es-submit-msg ${scheduleSubmitMsg.includes("successfully") ? "success" : "error"}`}>
                    {scheduleSubmitMsg}
                  </div>
                )}
              </form>
            </div>

            <div className="es-panel es-list-panel">
              <h5 className="es-list-title">Active Report Schedules</h5>
              
              {schedulesLoading ? (
                <div className="es-loading">Loading schedules...</div>
              ) : schedules.length === 0 ? (
                <div className="es-empty-state">
                  No automated report schedules configured yet.
                </div>
              ) : (
                <div className="es-list">
                  {schedules.map(sch => (
                    <div key={sch.id} className="es-list-item">
                      <div className="es-item-details">
                        <div className="es-item-header">
                          <span className={`es-status-tag ${sch.enabled ? "enabled" : "disabled"}`}>
                            {sch.enabled ? "Enabled" : "Disabled"}
                          </span>
                          <span className="es-item-report-type">
                            {Array.isArray(sch.report_type) 
                              ? sch.report_type.map(r => reportTypeMap[r] || r).join(", ")
                              : (sch.report_type?.includes(',') ? sch.report_type.split(',').map(r => reportTypeMap[r.trim()] || r.trim()).join(", ") : reportTypeMap[sch.report_type] || sch.report_type)}
                          </span>
                        </div>
                        <div className="es-item-freq-info">
                          {sch.schedule_type === "immediate" ? (
                            <span>Trigger <strong className="es-highlight">Immediately</strong> on event</span>
                          ) : (
                            <span>Sent <strong className="es-highlight">{sch.schedule_type}</strong> at <strong className="es-highlight">{sch.send_time || "09:00"}</strong> in <strong className="es-highlight">{sch.format?.toUpperCase()}</strong> format</span>
                          )}
                        </div>
                        <div className="es-item-recipients">
                          To: {sch.recipients?.join(", ")}
                        </div>
                        {sch.created_at && (
                          <div className="es-item-created-at" style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>
                            Created At: {new Date(sch.created_at.endsWith('Z') ? sch.created_at : sch.created_at + 'Z').toLocaleString()}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteSchedule(sch.id)}
                        className="es-btn-delete"
                        title="Delete schedule"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'compose' && (
          <div className="es-compose-container">
            <div className={`es-compose-sidebar ${historyOpen ? 'open' : ''}`}>
              <div className="es-sidebar-header">
                <span><Clock size={16} style={{marginRight: '6px', verticalAlign: 'text-bottom'}}/> Sent History</span>
                <button type="button" className="es-close-sidebar" onClick={() => setHistoryOpen(false)}>
                  <X size={16} />
                </button>
              </div>
              <div className="es-sidebar-content">
                {historyLoading ? (
                  <div className="es-loading">Loading...</div>
                ) : emailHistory.length === 0 ? (
                  <div className="es-empty-state" style={{padding: '16px', fontSize: '12px'}}>No sent emails found.</div>
                ) : (
                  emailHistory.map(h => (
                    <div key={h.id} className="es-history-item">
                      <div className="es-history-to">To: {h.to}</div>
                      <div className="es-history-subj">{h.subject || "(No Subject)"}</div>
                      <div className="es-history-time">{new Date(h.timestamp).toLocaleString()}</div>
                      {h.has_attachments && <div className="es-history-attach"><Paperclip size={10} /> Attachments</div>}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="es-panel es-compose-panel">
              <form onSubmit={handleSendManual} className="es-compose-form">
                <div className="es-compose-header">
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <Mail size={18} />
                    <span>New Message</span>
                  </div>
                  {!historyOpen && (
                    <button type="button" className="es-history-toggle" onClick={() => setHistoryOpen(true)} title="View Sent History">
                      <Clock size={16} /> History
                    </button>
                  )}
                </div>
                
                <div className="es-compose-row">
                  <span className="es-compose-label">To</span>
                  <TagInput tags={composeTo} setTags={setComposeTo} placeholder="Recipient emails separated by commas" />
                </div>
                
                <div className="es-compose-row">
                  <span className="es-compose-label">Cc</span>
                  <TagInput tags={composeCc} setTags={setComposeCc} placeholder="" />
                </div>
                
                <div className="es-compose-row">
                  <span className="es-compose-label">Subject</span>
                  <input 
                    type="text" 
                    className="es-compose-input es-compose-subject" 
                    value={composeSubject}
                    onChange={e => setComposeSubject(e.target.value)}
                    placeholder="Email Subject"
                  />
                </div>
                
                <div className="es-compose-body">
                  <RichTextEditor 
                    value={composeBody} 
                    onChange={setComposeBody} 
                    placeholder="Write your message here..." 
                  />
                </div>
                
                {composeFiles.length > 0 && (
                  <div className="es-compose-attachments">
                    {composeFiles.map((f, i) => (
                      <div key={i} className="es-attachment-chip">
                        <Paperclip size={12} />
                        <span>{f.name}</span>
                        <button type="button" onClick={() => removeFile(i)}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="es-compose-footer">
                  <button type="submit" className="es-btn-send" disabled={composeSending}>
                    <Send size={14} />
                    {composeSending ? "Sending..." : "Send"}
                  </button>
                  
                  <input 
                    type="file" 
                    multiple 
                    ref={fileInputRef} 
                    style={{display: 'none'}} 
                    onChange={handleFileSelect}
                  />
                  
                  <button 
                    type="button" 
                    className="es-btn-attach"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={16} /> Attach Files
                  </button>

                  {composeMsg && (
                    <div className={`es-compose-msg ${composeMsg.includes("successfully") ? "success" : "error"}`}>
                      {composeMsg}
                    </div>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
