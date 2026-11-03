import { useState, useEffect, useRef } from "react";
import SearchBar from "../../components/shared/SearchBar";
import SpecularButton from "../../components/shared/SpecularButton";
import { useTheme } from "../../context/ThemeContext";
import "./Recordingmethodpage.css";
import { getNumber, apiUrl } from '../../config/appConfig';


const DEFAULT_CONTINUOUS = {
  enabled: true,
  profile: "",
  prebuffer: 5,
  postbuffer: 5,
  avgBitrate: false,
  maxStorage: 50,
  schedule: "Always",
  availableProfiles: [],
  availableSchedules: [],
  motion_only: false,
};

function loadGroups() {
  try {
    const saved = localStorage.getItem("miradorai_groups");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function getAuthHeaders() {
  const token = localStorage.getItem("miradorai_token");
  return token ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

function injectAuth(url, user, pass) {
  if (!url || !user) return url;
  try {
    const baseUrl = url.replace(/^rtsp:\/\/([^@]+@)?/, "rtsp://");
    const encodedUser = encodeURIComponent(user);
    const encodedPass = encodeURIComponent(pass || "");
    return baseUrl.replace("rtsp://", `rtsp://${encodedUser}:${encodedPass}@`);
  } catch { return url; }
}

function stripRtspCredentials(url) {
  if (!url) return "";
  try {
    return url.replace(/^rtsp:\/\/([^@]+@)?/, "rtsp://");
  } catch { return url; }
}

export default function RecordingMethodPage() {
  const { theme } = useTheme();
  const initialDevices = (() => {
    try {
      const saved = localStorage.getItem("miradorai_devices");
      if (saved) {
        return JSON.parse(saved).map((localCam, idx) => ({
          ...localCam,
          group_id: localCam.group_id || "default",
          stream_key: localCam.stream_key || (localCam.ip ? `${localCam.ip.replace(/\./g, "_")}_cam${localCam.channel || 0}` : `cam_${localCam.id || idx}`),
        }));
      }
    } catch (e) {}
    return [];
  })();

  const buildRecSettings = (deviceList, currentSchedules = []) => {
    const settings = {};
    deviceList.forEach((cam) => {
      const profiles = cam.stream_profiles || [];
      let pVal = cam.active_rec_profile || cam.recording_profile || "MAIN_STREAM";
      if (profiles.length > 0 && pVal !== "MAIN_STREAM" && pVal !== "SUB_STREAM") {
        const sortedMain = [...profiles].sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)) || (b.bitrate || 0) - (a.bitrate || 0));
        const sortedSub = [...profiles].sort((a, b) => ((a.width || 0) * (a.height || 0)) - ((b.width || 0) * (b.height || 0)) || (a.bitrate || 0) - (b.bitrate || 0));
        if (pVal === sortedMain[0]?.token) pVal = "MAIN_STREAM";
        else if (pVal === sortedSub[0]?.token) pVal = "SUB_STREAM";
      }
      settings[cam.stream_key] = {
        continuous: {
          ...DEFAULT_CONTINUOUS,
          profile: pVal,
          availableProfiles: [
            { token: "MAIN_STREAM", label: "Main Stream", isGeneric: true },
            { token: "SUB_STREAM", label: "Sub Stream", isGeneric: true }
          ],
          schedule: cam.assigned_schedule_id || "Always",
          motion_only: !!cam.motion_only,
          availableSchedules: [
            { id: "Always", name: "Always" },
            ...(Array.isArray(currentSchedules) ? currentSchedules.map(s => ({ id: s.id, name: s.name })) : [])
          ]
        },
      };
    });
    return settings;
  };

  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [devices, setDevices] = useState(initialDevices);
  const [groups] = useState(loadGroups);
  const [loading, setLoading] = useState(false);
  const [recSettings, setRecSettings] = useState(() => buildRecSettings(initialDevices));
  const [schedules, setSchedules] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [checkedGroups, setCheckedGroups] = useState([]);
  const [checkedCams, setCheckedCams] = useState([]);
  const [toastMessage, setToastMessage] = useState(null);

  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [scheduleDropdownOpen, setScheduleDropdownOpen] = useState(false);
  const profileDropdownRef = useRef(null);
  const scheduleDropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target)) {
        setProfileDropdownOpen(false);
      }
      if (scheduleDropdownRef.current && !scheduleDropdownRef.current.contains(e.target)) {
        setScheduleDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const showToast = (message, isError = false) => {
    setToastMessage({ text: message, isError });
    setTimeout(() => setToastMessage(null), 3000);
  };

  useEffect(() => {
    const init = async () => {
      const [schs] = await Promise.all([
        fetchSchedules(),
        fetchDevices()
      ]);
      if (schs && schs.length > 0) {
        setRecSettings(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(key => {
            if (next[key]?.continuous) {
              next[key].continuous.availableSchedules = [
                { id: "Always", name: "Always" },
                ...schs.map(s => ({ id: s.id, name: s.name }))
              ];
            }
          });
          return next;
        });
      }
    };
    init();
  }, []);

  const fetchSchedules = async () => {
    try {
      const res = await fetch(apiUrl('/storage/schedules'), {
        headers: getAuthHeaders()
      });
      const data = await res.json();
      const schs = Array.isArray(data) ? data : [];
      setSchedules(schs);
      
      setRecSettings(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(key => {
          next[key].continuous.availableSchedules = [
            { id: "Always", name: "Always" },
            ...schs.map(s => ({ id: s.id, name: s.name }))
          ];
        });
        return next;
      });
      
      return schs;
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  const fetchDevices = async (currentSchedules = []) => {
    if (devices.length === 0) setLoading(true);
    
    try {
      let localDevices = [];
      try {
        const saved = localStorage.getItem("miradorai_devices");
        if (saved) localDevices = JSON.parse(saved);
      } catch (e) { console.error("[RM] LS Load error", e); }

      let backendData = [];
      try {
        const res = await fetch(apiUrl('/cameras'), {
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const json = await res.json();
          backendData = Array.isArray(json) ? json : (json.devices || []);
        }
      } catch (e) { console.warn("[RM] Backend fetch failed", e); }

      const combinedDevices = localDevices.map((localCam, idx) => {
        const backendCam = backendData.find(b => b.ip === localCam.ip);
        if (backendCam) {
          return {
            ...localCam,
            ...backendCam,
            group_id: localCam.group_id || backendCam.group_id || "default",
            stream_key: backendCam.stream_key || localCam.stream_key || (localCam.ip ? `${localCam.ip.replace(/\./g, "_")}_cam${localCam.channel || 0}` : `cam_${localCam.id || idx}`),
          };
        }
        return {
          ...localCam,
          group_id: localCam.group_id || "default",
          stream_key: localCam.stream_key || (localCam.ip ? `${localCam.ip.replace(/\./g, "_")}_cam${localCam.channel || 0}` : `cam_${localCam.id || idx}`),
        };
      });

      const backendOnly = backendData.filter(b => !localDevices.some(l => l.ip === b.ip)).map((b, idx) => ({
        ...b,
        group_id: b.group_id || "default",
        stream_key: b.stream_key || (b.ip ? `${b.ip.replace(/\./g, "_")}_cam${b.channel || 0}` : `cam_${b.id || idx}`),
      }));

      const finalData = [...combinedDevices, ...backendOnly];
      
      // Update state
      setDevices(finalData);
      try {
        localStorage.setItem("miradorai_devices", JSON.stringify(finalData));
      } catch (e) {
        console.error("[RM] LS Save error", e);
      }
      setRecSettings(buildRecSettings(finalData, currentSchedules));
      
    } catch (err) {
      console.error("[RM] Global fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const groupedData = Object.values(
    devices.reduce((acc, cam) => {
      const gid = cam.group_id || "default";
      if (!acc[gid]) {
        acc[gid] = {
          group_id: gid,
          name: gid === "default" ? "Default" : (groups.find(g => g.id === gid)?.name || gid),
          cameras: [],
        };
      }
      acc[gid].cameras.push(cam);
      return acc;
    }, {})
  );

  const filteredGroups = groupedData.filter(g =>
    !filter || g.name.toLowerCase().includes(filter.toLowerCase()) ||
    g.cameras.some(c => (c.name || "").toLowerCase().includes(filter.toLowerCase()) || (c.ip || "").includes(filter))
  );

  const updateSection = (section, data) => {
    const targets = checkedCams.length > 0 ? checkedCams : (selectedId ? [selectedId] : []);
    if (targets.length === 0) return;

    setRecSettings(prev => {
      const next = { ...prev };
      targets.forEach(tid => {
        if (next[tid]) {
          next[tid] = { ...next[tid], [section]: { ...next[tid][section], ...data } };
        }
      });
      return next;
    });
  };

  const updateProfile = (val) => {
    const targets = checkedCams.length > 0 ? checkedCams : (selectedId ? [selectedId] : []);
    if (targets.length === 0) return;

    // Check eligibility: camera must have at least 2 profiles to "switch"
    const ineligible = targets.filter(tid => {
      const cam = devices.find(d => d.stream_key === tid);
      return !cam || !cam.stream_profiles || cam.stream_profiles.length < 2;
    });

    if (ineligible.length > 0) {
      if (targets.length === 1) {
        showToast("This camera only has one stream profile and is not eligible for profile switching.", true);
      } else {
        showToast(`${ineligible.length} of the selected cameras only have one stream profile and are not eligible for profile switching.`, true);
      }
      return;
    }

    updateSection("continuous", { profile: val });
  };

  const updateSchedule = (val) => updateSection("continuous", { schedule: val });

  const handleApply = async () => {
    const targets = checkedCams.length > 0 ? checkedCams : (selectedId ? [selectedId] : []);
    if (targets.length === 0) return;

    setLoading(true);
    try {
      const templateId = (selectedId && recSettings[selectedId]) ? selectedId : checkedCams.find(id => recSettings[id]);
      const template = recSettings[templateId];

      if (!template) {
        showToast("No settings found for the selected camera(s). Please try refreshing.", true);
        setLoading(false);
        return;
      }

      const applyTasks = targets.map(async (tid) => {
        const cam = devices.find(d => d.stream_key === tid);
        if (!cam) return;

        const data = template.continuous;
        let targetProfile = null;

        if (data.profile === "MAIN_STREAM") {
          targetProfile = [...(cam.stream_profiles || [])].sort((a, b) => {
            const resA = (a.width || 0) * (a.height || 0);
            const resB = (b.width || 0) * (b.height || 0);
            if (resB !== resA) return resB - resA;
            return (b.bitrate || 0) - (a.bitrate || 0);
          })[0];
        } else if (data.profile === "SUB_STREAM") {
          targetProfile = [...(cam.stream_profiles || [])].sort((a, b) => {
            const resA = (a.width || 0) * (a.height || 0);
            const resB = (b.width || 0) * (b.height || 0);
            if (resA !== resB) return resA - resB;
            return (a.bitrate || 0) - (b.bitrate || 0);
          })[0];
        } else {
          const templateProfile = template.continuous.availableProfiles?.find(p => p.token === data.profile);
          targetProfile = cam.stream_profiles?.find(p => p.label === templateProfile?.label) || cam.stream_profiles?.[0];
        }

        let authedRtsp = null;
        let profileToken = "";

        if (targetProfile) {
          authedRtsp = injectAuth(targetProfile.rtsp_url, cam.username, cam.password);
          profileToken = targetProfile.token;
        } else {
          authedRtsp = injectAuth(cam.rtsp_url, cam.username, cam.password);
          profileToken = data.profile || "SUB_STREAM";
        }

        const hasMultipleProfiles = cam.stream_profiles && cam.stream_profiles.length >= 2;
        const currentRtspClean = stripRtspCredentials(cam.recording_rtsp || cam.rtsp_url);
        const targetRtspClean = stripRtspCredentials(authedRtsp);
        const rtspUrlChanged = targetRtspClean && currentRtspClean && (targetRtspClean !== currentRtspClean);

        const profileChanged = hasMultipleProfiles && 
                               (profileToken !== cam.active_rec_profile) && 
                               (profileToken !== cam.recording_profile);

        const needsStreamAssign = rtspUrlChanged || profileChanged;

        if (authedRtsp && needsStreamAssign) {
          console.log(`[RM] Re-assigning stream for ${cam.ip} (profile/RTSP changed)`);
          await fetch(apiUrl('/streams/assign'), {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
              ip: cam.ip,
              port: cam.port || getNumber("CAMERA_DEFAULT_PORT", 80),
              username: cam.username || "",
              live_rtsp: cam.rtsp_url,
              recording_rtsp: authedRtsp,
              live_profile: cam.active_live_profile || "MAIN",
              recording_profile: profileToken,
              manufacturer: cam.manufacturer,
              model: cam.model,
              mac: cam.mac,
              device_name: cam.device_name || cam.name || "",
              stream_key: cam.stream_key,
            }),
          });
        } else {
          console.log(`[RM] Skipping stream re-assignment for ${cam.ip} (unchanged)`);
        }

        await fetch(apiUrl('/recordings/assign-schedule'), {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            camera_id: tid,
            schedule_id: data.schedule,
            motion_only: !!data.motion_only,
          }),
        });

        if (data.schedule === "Never") {
          try {
            await fetch(apiUrl(`/recordings/stop/${cam.stream_key}`), {
              method: "POST",
              headers: getAuthHeaders(),
            });
            console.log(`[RM] Stopped recording for ${cam.stream_key} as schedule is Never`);
          } catch (e) {
            console.error(`[RM] Error stopping recording for ${cam.stream_key}:`, e);
          }
        }
      });

      await Promise.all(applyTasks);

      setRecSettings(prev => {
        const next = { ...prev };
        targets.forEach(tid => {
          if (next[tid]) {
            next[tid] = {
              ...next[tid],
              continuous: {
                ...next[tid].continuous,
                profile: template.continuous.profile,
                schedule: template.continuous.schedule,
                motion_only: template.continuous.motion_only
              }
            };
          }
        });
        return next;
      });

      showToast(`Successfully applied settings to ${targets.length} camera(s)!`);
      await fetchDevices(schedules);
      setCheckedCams([]);
      setCheckedGroups([]);
    } catch (err) {
      console.error(err);
      showToast("Failed to apply settings.", true);
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (gid) => {
    const isChecked = checkedGroups.includes(gid);
    const group = groupedData.find(g => g.group_id === gid);
    const camIds = group?.cameras.map(c => c.stream_key) || [];

    if (isChecked) {
      setCheckedGroups(prev => prev.filter(id => id !== gid));
      setCheckedCams(prev => prev.filter(id => !camIds.includes(id)));
    } else {
      setCheckedGroups(prev => [...prev, gid]);
      setCheckedCams(prev => [...new Set([...prev, ...camIds])]);
    }
  };

  const toggleCam = (cid) => {
    setCheckedCams(prev => prev.includes(cid) ? prev.filter(id => id !== cid) : [...prev, cid]);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-header__left">
          <h1 className="page-title">Recording <span>Method</span></h1>
        </div>
        <SearchBar value={filter} onChange={setFilter} placeholder="Filter groups or cameras..." />
      </div>

      <div className="app-content">
        <div className={`rm-content-layout ${selectedGroup ? "has-panel" : ""}`}>
          <div className="rm-table-wrap card">
            <table className="rm-table m-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      checked={filteredGroups.length > 0 && filteredGroups.every(g => checkedGroups.includes(g.group_id))}
                      onChange={() => {
                        const allGids = filteredGroups.map(g => g.group_id);
                        const allChecked = filteredGroups.every(g => checkedGroups.includes(g.group_id));
                        if (allChecked) {
                          setCheckedGroups([]);
                          setCheckedCams([]);
                        } else {
                          setCheckedGroups(allGids);
                          const allCids = filteredGroups.flatMap(g => g.cameras.map(c => c.stream_key));
                          setCheckedCams(allCids);
                        }
                      }}
                    />
                  </th>
                  <th style={{ color: "#ffffff" }}>Group Name</th>
                  <th style={{ width: 120, color: "#ffffff", textAlign: 'center' }}>Continuous</th>
                  <th style={{ width: 120, color: "#ffffff", textAlign: 'center' }}>Scheduled</th>
                  <th style={{ width: 130, color: "#ffffff", textAlign: 'center' }}>Motion Based</th>
                  <th style={{ width: 150, color: "#ffffff" }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="m-table__empty" style={{ textAlign: "center", padding: "40px", color: "rgba(255,255,255,0.3)" }}>
                      {devices.length === 0
                        ? "No cameras enrolled. Go to Add Devices first."
                        : "No groups match your filter."}
                    </td>
                  </tr>
                ) : filteredGroups.map(group => {
                  const continuousCount = group.cameras.filter(c => c.assigned_schedule_id === "Always" || !c.assigned_schedule_id).length;
                  const scheduledCount = group.cameras.length - continuousCount;
                  const motionCount = group.cameras.filter(c => recSettings[c.stream_key]?.continuous?.motion_only || c.motion_only).length;
                  return (
                    <tr key={group.group_id} className={checkedGroups.includes(group.group_id) ? "selected" : ""}>
                      <td><input type="checkbox" checked={checkedGroups.includes(group.group_id)} onChange={() => toggleGroup(group.group_id)} /></td>
                      <td className="m-table__primary">{group.name}</td>
                      <td style={{ textAlign: 'center' }}><span className="count-badge continuous">{continuousCount}</span></td>
                      <td style={{ textAlign: 'center' }}><span className="count-badge scheduled">{scheduledCount}</span></td>
                      <td style={{ textAlign: 'center' }}><span className="count-badge motion" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)' }}>{motionCount}</span></td>
                      <td>
                        <SpecularButton
                          size="sm"
                          radius={8}
                          tint="#10b981"
                          tintOpacity={0.10}
                          blur={4}
                          textColor={theme === 'light' ? "#065f46" : "#f0fff8"}
                          lineColor="#10b981"
                          baseColor={theme === 'light' ? "#d1fae5" : "#0d3326"}
                          intensity={1.2}
                          shineSize={12}
                          shineFade={38}
                          thickness={1}
                          speed={0.35}
                          followMouse
                          proximity={220}
                          autoAnimate={false}
                          className="m-btn m-btn--primary"
                          onClick={() => setSelectedGroup(group)}
                        >
                          <span style={{ whiteSpace: "nowrap" }}>View All Cameras</span>
                        </SpecularButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedGroup && (
            <div className="rm-side-panel card">
              <div className="rm-side-header">
                <h3>{selectedGroup.name}</h3>
                <button className="close-btn" onClick={() => setSelectedGroup(null)}>✕</button>
              </div>
              <div className="rm-side-list">
                {selectedGroup.cameras.map(cam => (
                  <div
                    key={cam.stream_key}
                    className={`rm-side-item ${selectedId === cam.stream_key ? "active" : ""} ${checkedCams.includes(cam.stream_key) ? "checked" : ""}`}
                    onClick={() => setSelectedId(cam.stream_key)}
                  >
                    <input
                      type="checkbox"
                      checked={checkedCams.includes(cam.stream_key)}
                      onChange={(e) => { e.stopPropagation(); toggleCam(cam.stream_key); }}
                    />
                    <div className="rm-item-info">
                      <div className="rm-item-header">
                        <span className="rm-item-name" title={cam.name || cam.ip}>
                          {cam.name || "Unnamed Camera"}
                        </span>
                        <span className="rm-stream-badge">
                          {(recSettings[cam.stream_key]?.continuous?.profile || cam.active_rec_profile) === "MAIN_STREAM" ? "MAIN" : "SUB"}
                        </span>
                      </div>
                      <div className="rm-item-sub">
                        {cam.ip && <span className="rm-item-ip">{cam.ip}</span>}
                        {cam.ip && <span className="rm-item-dot">•</span>}
                        <span className="rm-item-mode">
                          {(() => {
                            let baseMode = "Scheduled";
                            if (!cam.assigned_schedule_id || cam.assigned_schedule_id === "Always") {
                              baseMode = "Continuous";
                            } else if (cam.assigned_schedule_id === "Never" || cam.assigned_schedule_id.toString().toLowerCase() === "never") {
                              baseMode = "Never";
                            }
                            return cam.motion_only ? `${baseMode} (Motion)` : baseMode;
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {(selectedId || checkedCams.length > 0) && (
          <div className="rm-detail-horizontal">
            <div className="rm-h-group">
              <div className="rm-h-field" ref={profileDropdownRef}>
                <label className="rm-h-label">Profiles</label>
                <div className="rm-custom-select">
                  <button
                    type="button"
                    className="rm-select-btn"
                    onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  >
                    <span>
                      {(() => {
                        const curProfile = selectedId 
                          ? recSettings[selectedId]?.continuous?.profile 
                          : recSettings[checkedCams[0]]?.continuous?.profile || "SUB_STREAM";
                        return curProfile === "MAIN_STREAM" ? "Main Stream" : "Sub Stream";
                      })()}
                    </span>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transform: profileDropdownOpen ? "rotate(180deg)" : "rotate(0)",
                        transition: "transform .2s",
                        color: "var(--text-secondary)"
                      }}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {profileDropdownOpen && (
                    <ul className="rm-dropdown-menu">
                      <li
                        className={`rm-dropdown-item ${
                          (selectedId ? recSettings[selectedId]?.continuous?.profile : recSettings[checkedCams[0]]?.continuous?.profile) === "MAIN_STREAM" ? "active" : ""
                        }`}
                        onClick={() => {
                          updateProfile("MAIN_STREAM");
                          setProfileDropdownOpen(false);
                        }}
                      >
                        Main Stream
                      </li>
                      <li
                        className={`rm-dropdown-item ${
                          (selectedId ? recSettings[selectedId]?.continuous?.profile : recSettings[checkedCams[0]]?.continuous?.profile) === "SUB_STREAM" ? "active" : ""
                        }`}
                        onClick={() => {
                          updateProfile("SUB_STREAM");
                          setProfileDropdownOpen(false);
                        }}
                      >
                        Sub Stream
                      </li>
                    </ul>
                  )}
                </div>
              </div>

              <div className="rm-h-sep" style={{ color: "rgba(255, 255, 255, 0.5)" }}>|</div>

              <div className="rm-h-field" ref={scheduleDropdownRef}>
                <label className="rm-h-label">Recording mode</label>
                <div className="rm-custom-select">
                  <button
                    type="button"
                    className="rm-select-btn"
                    onClick={() => setScheduleDropdownOpen(!scheduleDropdownOpen)}
                  >
                    <span>
                      {(() => {
                        const curSch = selectedId
                          ? recSettings[selectedId]?.continuous?.schedule || "Always"
                          : recSettings[checkedCams[0]]?.continuous?.schedule || "Always";
                        if (curSch && curSch.toString().toLowerCase() === "always") return "Continuous";
                        if (curSch && curSch.toString().toLowerCase() === "never") return "Never";
                        return schedules.find(s => s.id === curSch)?.name || curSch;
                      })()}
                    </span>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        transform: scheduleDropdownOpen ? "rotate(180deg)" : "rotate(0)",
                        transition: "transform .2s",
                        color: "var(--text-secondary)"
                      }}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  {scheduleDropdownOpen && (
                    <ul className="rm-dropdown-menu">
                      <li
                        className={`rm-dropdown-item ${
                          (() => {
                            const curSch = selectedId ? recSettings[selectedId]?.continuous?.schedule : recSettings[checkedCams[0]]?.continuous?.schedule;
                            return (curSch && curSch.toString().toLowerCase() === "always") ? "active" : "";
                          })()
                        }`}
                        onClick={() => {
                          updateSchedule("Always");
                          setScheduleDropdownOpen(false);
                        }}
                      >
                        Continuous
                      </li>
                      {schedules.map(s => (
                        <li
                          key={s.id}
                          className={`rm-dropdown-item ${
                            (selectedId ? recSettings[selectedId]?.continuous?.schedule : recSettings[checkedCams[0]]?.continuous?.schedule) === s.id ? "active" : ""
                          }`}
                          onClick={() => {
                            updateSchedule(s.id);
                            setScheduleDropdownOpen(false);
                          }}
                        >
                          {s.name}
                        </li>
                      ))}
                      <li
                        className={`rm-dropdown-item ${
                          (() => {
                            const curSch = selectedId ? recSettings[selectedId]?.continuous?.schedule : recSettings[checkedCams[0]]?.continuous?.schedule;
                            return (curSch && curSch.toString().toLowerCase() === "never") ? "active" : "";
                          })()
                        }`}
                        onClick={() => {
                          updateSchedule("Never");
                          setScheduleDropdownOpen(false);
                        }}
                      >
                        Never
                      </li>
                    </ul>
                  )}
                </div>
              </div>

              <div className="rm-h-sep" style={{ color: "rgba(255, 255, 255, 0.5)" }}>|</div>

              <div className="rm-h-field" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 5px" }}>
                <label htmlFor="motion-only-checkbox" className="rm-h-label" style={{ marginRight: "5px", cursor: "pointer" }}>
                  Record on Motion Only
                </label>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    id="motion-only-checkbox"
                    checked={(() => {
                      const currentTarget = selectedId 
                        ? recSettings[selectedId]?.continuous 
                        : recSettings[checkedCams[0]]?.continuous;
                      return !!currentTarget?.motion_only;
                    })()}
                    onChange={(e) => {
                      updateSection("continuous", { motion_only: e.target.checked });
                    }}
                    style={{
                      width: "18px",
                      height: "18px",
                      cursor: "pointer",
                      accentColor: "#3b82f6",
                      borderRadius: "4px",
                      border: "1px solid rgba(255, 255, 255, 0.2)"
                    }}
                  />
                </div>
              </div>

              <div className="rm-h-sep" style={{ color: "rgba(255, 255, 255, 0.5)" }}>|</div>

              <SpecularButton
                size="md"
                radius={8}
                tint="#10b981"
                tintOpacity={0.10}
                blur={4}
                textColor={theme === 'light' ? "#065f46" : "#f0fff8"}
                lineColor="#10b981"
                baseColor={theme === 'light' ? "#d1fae5" : "#0d3326"}
                intensity={1.2}
                shineSize={12}
                shineFade={38}
                thickness={1}
                speed={0.35}
                followMouse
                proximity={220}
                autoAnimate={false}
                className="m-btn m-btn--primary"
                onClick={handleApply}
                disabled={loading}
              >
                <div style={{ minWidth: 120, textAlign: 'center' }}>
                  {loading ? "Applying..." : (checkedCams.length > 1 ? `Apply to ${checkedCams.length} Cameras` : "Apply")}
                </div>
              </SpecularButton>
            </div>
          </div>
        )}

        {!selectedGroup && !selectedId && !checkedCams.length && filteredGroups.length > 0 && (
          <div className="rm-detail rm-detail--empty">
            <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>Select a camera or group above to configure recording settings.</span>
          </div>
        )}

        {toastMessage && (
          <div className={`rm-toast ${toastMessage.isError ? "rm-toast--error" : ""}`}>
            {toastMessage.text}
          </div>
        )}
      </div>
    </div>
  );
}