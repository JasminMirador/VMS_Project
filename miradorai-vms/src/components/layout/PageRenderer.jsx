import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import SupervisorModal from "./SupervisorModal";

import AddDevicesPage from "../../pages/devices/AddDevicesPage";
import CamerasPage from "../../pages/devices/CamerasPage";
import OtherDevicesPage from "../../pages/devices/OtherDevicesPage";
import StreamProfilesPage from "../../pages/devices/StreamProfilesPage";
import ImageConfigPage from "../../pages/devices/ImageConfigPage";
import PTZPresetsPage from "../../pages/devices/PTZPresetsPage";
import ManagementPage from "../../pages/devices/ManagementPage";
import ExternalDataPage from "../../pages/devices/ExternalDataPage";
import TimeSyncPage from "../../pages/devices/TimeSyncPage";
import CameraFeaturesPage from "../../pages/devices/CameraFeaturesPage";

import StorageMgmtPage from "../../pages/storage/StorageManagementPage";
import StorageSelPage from "../../pages/storage/StorageSelectionPage";

import RecordingPage from "../../pages/recording/RecordingPage";
import EventsPage from "../../pages/recording/EventsPage";
import TriggersPage from "../../pages/recording/TriggersPage";
import Schedules from "../../pages/recording/Schedules";
import RecordingMethodPage from "../../pages/recording/Recordingmethodpage";
import IOPortsPage from "../../pages/recording/IOPortsPage";
import ActionRulesPage from "../../pages/recording/Actionrulespage";

import ProfilePage from "../../pages/auth/ProfilePage";
import ClientSettingsPage from "../../pages/client/ClientSettingsPage";
import UserSettingsPage from "../../pages/client/Usersettingspage";
import UserManagementPage from "../../pages/client/UserManagementPage";
import StreamingPage from "../../pages/client/StreamingPage";
import AboutPage from "../../pages/client/AboutPage";
import ViewingStationsPage from "../../pages/client/ViewingStationsPage";
import EmailSchedulesPage from "../../pages/client/EmailSchedulesPage";
import IntegrationPage from "../../pages/client/IntegrationPage";

import FirmwareUpgradePage from "../../pages/connectedservices/Firmwareupgradepage";
import SmartSearchSettingsPage from "../../pages/smartsearch/Smartsearchsettingspage";

import LiveViewPage from "../../pages/liveview/LiveViewPage";

import MediaPlayerPage from "../../pages/admin/MediaPlayerPage";
import BackupPage from "../../pages/admin/BackupPage";
import LogsPage from "../../pages/logs/LogsPage";

// ✅ IMPORTANT PAGES
import DashboardPage from "../../pages/Dashboard/DashboardPage";
import MapViewPage from "../../pages/mapview/MapViewPage";
import TopologyPage from "../../pages/infrastructure/Topology";
import NetworkHealthPage from "../../pages/diagnostics/NetworkHealthPage";
import DesignerView from "../../pages/Mapview/DesignerView";
import MaskingPage from "../../pages/devices/MaskingPage";
import ForensicSearchPage from "../../pages/forensic/ForensicSearchPage";
import AiAnalyticsPage from "../../pages/analytics/AiAnalyticsPage";
import SystemPerformancePage from "../../pages/diagnostics/SystemPerformancePage";
import RaidMgmtPage from "../../pages/StorageManagement";
import VideoSynopsis from "../../pages/analytics/VideoSynopsisPage";
import FaceDetectionPage from "../../pages/analytics/FaceDetectionPage";



// ✅ REPORTS
import CameraHistoryReport from "../../pages/reports/CameraHistoryReport";
import ReportsPlaceholderPage from "../../pages/reports/ReportsPlaceholderPage";
import RecycleBinPage from "../../pages/devices/RecycleBinPage";
import PendingApprovalsPage from "../../pages/admin/PendingApprovalsPage";

// const RecordingReportPage = (props) => <ReportsPlaceholderPage {...props} reportName="Recording Report" />;
const StorageReportPage = (props) => <ReportsPlaceholderPage {...props} reportName="Storage Report" />;
const AnalyticsReportPage = (props) => <ReportsPlaceholderPage {...props} reportName="Analytics Report" />;

// ================= PAGE MAP =================
const MAP = {
  // ✅ DASHBOARD (DEFAULT PAGE)
  "dashboard": DashboardPage,
  "video-synopsis":VideoSynopsis,
  "face-detection": FaceDetectionPage,
  "ai-analytics": AiAnalyticsPage,

  // ================= DEVICES =================
  "add-devices": AddDevicesPage,
  "cameras": CamerasPage,
  "other-devices": OtherDevicesPage,
  "stream-profiles": StreamProfilesPage,
  "image-config": ImageConfigPage,
  "ptz-presets": PTZPresetsPage,
  "device-mgmt": ManagementPage,
  "ext-data": ExternalDataPage,
  "time-sync": TimeSyncPage,
  "camera-features": CameraFeaturesPage,
  "masking": MaskingPage,
  "recycle-bin": RecycleBinPage,
  // ================= STORAGE =================
  "storage-mgmt": StorageMgmtPage,
  "storage-selection": StorageSelPage,

  // ================= RECORDING =================
  "recording": RecordingPage,
  "events": EventsPage,
  "triggers": TriggersPage,
  "schedules": Schedules,
  "rec-method": RecordingMethodPage,
  "io-ports": IOPortsPage,
  "action-rules": ActionRulesPage,

  // ================= CLIENT =================
  "profile": ProfilePage,
    "client-settings": ClientSettingsPage,
  "user-settings": UserSettingsPage,
  "user-management": UserManagementPage,
  "integration": IntegrationPage,
  "streaming": StreamingPage,
  "about": AboutPage,
  "viewing-stations": ViewingStationsPage,
  "email-schedules": EmailSchedulesPage,

  // ================= SERVICES =================
  "firmware-upgrade": FirmwareUpgradePage,
  "smartsearch-settings": SmartSearchSettingsPage,
  "forensic-search": ForensicSearchPage,

  // ================= REPORTS =================
  // "recording-report": RecordingReportPage,
  "recording-report": CameraHistoryReport,

  "storage-report": StorageReportPage,
  "analytics-report": AnalyticsReportPage,



  // ================= LIVE =================
  "live-view": LiveViewPage,

  // ================= ADMIN =================
  "media-player": MediaPlayerPage,
  "backup": BackupPage,
  "logs": LogsPage,
  "map-view": MapViewPage,
  "infrastructure": NetworkHealthPage,
  "topology-map": TopologyPage,
  "designer-view": DesignerView,
  "network-health": NetworkHealthPage,
  "system-performance": SystemPerformancePage,
  "raid-mgmt": RaidMgmtPage,
  "approvals": PendingApprovalsPage,
};

// Pages that require supervisor unlock for CLIENT role
const CLIENT_SUPERVISOR_PAGES = ["media-player", "backup", "masking"];
const CLIENT_BLOCKED_PAGES = ["designer-view", "topology-map", "network-health", "system-performance", "raid-mgmt", "viewing-stations", "user-management"];

// Pages the OPERATOR role is allowed to access
const OPERATOR_ALLOWED_PAGES = ["live-view", "map-view", "client-settings", "profile", "ai-analytics"];

// Friendly names for the supervisor modal
const SUPERVISOR_PAGE_NAMES = {
  "media-player": "Playback",
  "backup": "Backup",
  "masking": "Privacy Masking",
};

// ================= MAIN RENDERER =================
export default function PageRenderer({ activePage, onNavigate }) {
  const { user, supervisorUnlocked, unlockSupervisor } = useAuth();
  const navigate = useNavigate();
  const role = user?.role;
  const [refreshKey, setRefreshKey] = useState(0);

  const basePage = activePage ? activePage.split("/")[0] : "";

  // --- Listen to refresh event ---
  useEffect(() => {
    const handleRefresh = () => setRefreshKey((k) => k + 1);
    window.addEventListener('appRefresh', handleRefresh);
    return () => window.removeEventListener('appRefresh', handleRefresh);
  }, []);

  // --- Redirects ---
  useEffect(() => {
    if (role === "operator" && !OPERATOR_ALLOWED_PAGES.includes(activePage) && !OPERATOR_ALLOWED_PAGES.includes(basePage)) {
      navigate("/live-view", { replace: true });
    }
  }, [activePage, basePage, role, navigate]);

  useEffect(() => {
    if (role === "client" && (CLIENT_BLOCKED_PAGES.includes(activePage) || CLIENT_BLOCKED_PAGES.includes(basePage))) {
      navigate("/live-view", { replace: true });
    }
  }, [activePage, basePage, role, navigate]);

  useEffect(() => {
    if ((activePage === "user-management" || basePage === "user-management") && role !== "admin") {
      navigate("/live-view", { replace: true });
    }
  }, [activePage, basePage, role, navigate]);

  // --- Synchronous rendering blocks (prevent flash of unauthorized content) ---
  if (role === "operator" && !OPERATOR_ALLOWED_PAGES.includes(activePage) && !OPERATOR_ALLOWED_PAGES.includes(basePage)) {
    return null;
  }
  if (role === "client" && (CLIENT_BLOCKED_PAGES.includes(activePage) || CLIENT_BLOCKED_PAGES.includes(basePage))) {
    return null;
  }
  if ((activePage === "user-management" || basePage === "user-management") && role !== "admin") {
    return null;
  }

  // --- Supervisor check ---
  const needsSupervisor = role === "client" && (CLIENT_SUPERVISOR_PAGES.includes(activePage) || CLIENT_SUPERVISOR_PAGES.includes(basePage)) && !supervisorUnlocked;

  if (needsSupervisor) {
    return (
      <SupervisorModal
        pageName={SUPERVISOR_PAGE_NAMES[activePage] || SUPERVISOR_PAGE_NAMES[basePage] || activePage}
        onSuccess={() => unlockSupervisor()}
        onCancel={() => navigate("/live-view", { replace: true })}
      />
    );
  }

  // ✅ fallback to basePage or dashboard if page not found
  const Component = MAP[activePage] || MAP[basePage] || DashboardPage;
  return <Component key={`${activePage}-${refreshKey}`} onNavigate={onNavigate || ((page) => navigate(`/${page}`))} />;
}
