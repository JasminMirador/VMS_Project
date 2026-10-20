import React, { useState, useEffect } from "react";
import SplashScreen from "../../components/layout/SplashScreen";
import { fetchAndCacheAiIp, getCachedAiIp } from "../../utils/aiIntegration";
import "./AiAnalyticsPage.css";

export default function AiAnalyticsPage() {
  const [showSplash, setShowSplash] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);
  const [externalAiIp, setExternalAiIp] = useState(getCachedAiIp());
  const [iframeSrc, setIframeSrc] = useState("");

  useEffect(() => {
    fetchAndCacheAiIp().then((ip) => {
      setExternalAiIp(ip);
    });
  }, []);

  const handleSplashDone = () => {
    setShowSplash(false);
    setContentVisible(true);
  };

  useEffect(() => {
    const buildIframeSrc = async () => {
      if (externalAiIp && !iframeSrc) {
        // Get current logged-in email from localStorage
        let email = "";
        try {
          const userStr = localStorage.getItem("miradorai_user") || sessionStorage.getItem("miradorai_user");
          if (userStr) {
            const user = JSON.parse(userStr);
            if (user && user.email) {
              email = user.email;
            }
          }
        } catch (e) {
          console.error("Failed to parse user from storage", e);
        }

        // Fetch dynamic appName and accessToken from integrations
        let ssoAppName = "";
        let ssoAccessToken = "";
        try {
          const tokenForApi = localStorage.getItem("token") || (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
          const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "";
          const integRes = await fetch(`${API_BASE}/api/integrations`, {
            headers: { Authorization: tokenForApi ? `Bearer ${tokenForApi}` : "" }
          });
          if (integRes.ok) {
            const integrations = await integRes.json();
            const aiInteg = integrations.find(c => (c.type === "Mirador AI" || c.appName) && c.accessToken);
            if (aiInteg && aiInteg.appName && aiInteg.accessToken) {
              ssoAppName = aiInteg.appName;
              ssoAccessToken = aiInteg.accessToken;
            }
          }
        } catch (e) {
          console.warn("[AiAnalyticsPage] Failed to fetch dynamic appName/accessToken from integrations", e);
        }

        let baseUrl = `http://${externalAiIp}/unsecure/vms-auto-login?redirect=true`;
        if (email) baseUrl += `&email=${email}`;
        if (ssoAppName) baseUrl += `&appName=${encodeURIComponent(ssoAppName)}`;
        if (ssoAccessToken) baseUrl += `&accessToken=${encodeURIComponent(ssoAccessToken)}`;

        // Direct GET request via iframe src
        setIframeSrc(baseUrl);
      }
    };

    buildIframeSrc();
  }, [externalAiIp, iframeSrc]);

  return (
    <>
      {showSplash && (
        <SplashScreen
          onDone={handleSplashDone}
          title="MIRADOR AI"
          subtitle="ANALYTICS DASHBOARD"
        />
      )}
      <div
        className="ai-analytics-page"
        style={{ opacity: contentVisible ? 1 : 0, transition: "opacity 0.5s ease", display: showSplash ? "none" : "flex", height: "100%", width: "100%" }}
      >
        <div className="ai-analytics-content" style={{ width: "100%", height: "100%" }}>
          {iframeSrc && (
            <iframe
              src={iframeSrc}
              title="MIRADOR AI Analytics Dashboard"
              className="ai-analytics-iframe"
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          )}
        </div>
      </div>
    </>
  );
}

