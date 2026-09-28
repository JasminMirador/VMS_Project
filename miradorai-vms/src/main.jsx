import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import "./mobile.css";
 
// Global Fetch Interceptor to attach JWT token
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
 
  // Attach VMS JWT token to all VMS backend API calls (port 8000 or /api/ paths)
  if (typeof resource === 'string' && (resource.includes(':8000') || resource.includes('/api/'))) {
    const token = localStorage.getItem('miradorai_token');
    if (token) {
      config = config || {};
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${token}`
      };
    }
  }

  // Attach SSO JWT token to all integration server calls.
  // Covers both direct calls (port 8080) and calls via the /external-ai-api proxy.
  // But NOT to the keybasedlogin endpoint itself (that's where we get the token).
  const isIntegrationCall = (
    typeof resource === 'string' && (
      (resource.includes(':8080') && !resource.includes('/unsecure/keybasedlogin')) ||
      resource.includes('/external-ai-api')
    )
  );
  if (isIntegrationCall) {
    const ssoToken = localStorage.getItem('miradorai_sso_token');
    if (ssoToken) {
      config = config || {};
      config.headers = {
        ...config.headers,
        Authorization: ssoToken // already contains "Bearer <token>"
      };
      console.log('[SSO-INTERCEPT] Attaching SSO token to:', resource);
    }
  }
 
  const response = await originalFetch(resource, config);
 
  // Handle unauthorized responses globally
  if (response.status === 401 && !resource.includes('/api/auth/') && !resource.includes('/unsecure/keybasedlogin')) {
    console.warn("Unauthorized API call:", resource);
    const hadToken = Boolean(localStorage.getItem('miradorai_token'));
    localStorage.removeItem('miradorai_user');
    localStorage.removeItem('miradorai_token');
    localStorage.removeItem('miradorai_session_id');
    
    // Only force redirect if there was an active token and user is on a protected route
    if (hadToken && window.location.pathname !== '/' && window.location.pathname !== '/login') {
      window.location.href = '/';
    } else {
      window.location.href = '/';
    }
  }
 
  return response;
};
 
ReactDOM.createRoot(document.getElementById("root")).render(
  <App />
);