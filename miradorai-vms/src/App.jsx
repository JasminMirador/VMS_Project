
import { useState, useEffect } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import NumberTranslator from "./translation/NumberTranslator";
 
import { AuthProvider, useAuth } from "./context/AuthContext";
 
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import PageRenderer from "./components/layout/PageRenderer";
import SplashScreen from "./components/layout/SplashScreen";
import AlarmsPanel from "./components/layout/AlarmsPanel";
import LoginPage from "./pages/auth/LoginPage";
import AiAnalyticsPage from "./pages/analytics/AiAnalyticsPage";
 
import useActivityLogger from "./hooks/useActivityLogger"; // ✅ FIXED import
 
import { ThemeProvider } from "./context/ThemeContext";
import { UserSettingsProvider } from "./context/UserSettingsContext";
import { NotificationProvider } from "./context/NotificationContext";
import { CamerasProvider } from "./context/CamerasContext";
 
import GlobalLiveMirror from "./components/layout/GlobalLiveMirror";
 
import "./styles/global.css";
 
function AppContent() {
  const { isAuthenticated, isLoading, userRole } = useAuth();
  const location = useLocation();
 
  useActivityLogger(); // ✅ correct
 
  const activePage =
    location.pathname.replace("/", "") || "dashboard";
 
  const [showSplash, setShowSplash] = useState(true);
  const [appVisible, setAppVisible] = useState(false);
  const [alarmsOpen, setAlarmsOpen] = useState(false);
 
  // ==============================
  // LANGUAGE STATE — TRANSLATION
  // ==============================
  const [language, setLanguage] = useState(
    localStorage.getItem("mirador_language") || "en"
  );
 
  const isArabic = language === "ar";
 
  const handleLanguageChange = (newLanguage) => {
    setLanguage(newLanguage);
 
    localStorage.setItem(
      "mirador_language",
      newLanguage
    );
  };
 
  // ==============================
  // RTL / LTR — TRANSLATION
  // ==============================
  useEffect(() => {
    document.documentElement.lang = isArabic ? "ar" : "en";
    document.documentElement.dir = isArabic ? "rtl" : "ltr";
  }, [isArabic]);
 
  const handleSplashDone = () => {
    setShowSplash(false);
 
    setTimeout(() => setAppVisible(true), 50);
  };
 
  if (isLoading) {
    return <SplashScreen onDone={() => {}} />;
  }
 
  if (!isAuthenticated) {
    return <LoginPage />;
  }
 
  return (
    <>
      <GlobalLiveMirror />
 
      <NumberTranslator />
 
      {showSplash && (
        <SplashScreen onDone={handleSplashDone} />
      )}
 
      <div
        className="app-root"
        style={{
          opacity: appVisible ? 1 : 0,
          transition: "opacity 0.5s ease"
        }}
      >
        <Sidebar userRole={userRole} />
 
        <div className="app-main-area">
          <TopBar
            activePage={activePage}
            onAlarmsClick={() => setAlarmsOpen((p) => !p)}
            alarmsOpen={alarmsOpen}
            language={language}
            onLanguageChange={handleLanguageChange}
          />
 
          <main className="app-content">
            <PageRenderer
              activePage={activePage}
              userRole={userRole}
            />
          </main>
 
          <AlarmsPanel
            open={alarmsOpen}
            onClose={() => setAlarmsOpen(false)}
          />
        </div>
      </div>
    </>
  );
}
 
export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <UserSettingsProvider>
          <BrowserRouter>
            <NotificationProvider>
              <CamerasProvider>
                <AppContent />
              </CamerasProvider>
            </NotificationProvider>
          </BrowserRouter>
        </UserSettingsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}