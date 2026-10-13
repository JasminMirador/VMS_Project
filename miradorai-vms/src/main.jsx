import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Toast from "./components/shared/Toast";
import "./styles/global.css";
import "./mobile.css";
 
// Global Fetch Interceptor to attach JWT token
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;

  // Global strict input validation for name and title fields
  if (config && config.method && ["POST", "PUT", "PATCH"].includes(config.method.toUpperCase()) && config.body && typeof config.body === "string") {
    try {
      const bodyObj = JSON.parse(config.body);
      const nameRegex = /^[a-zA-Z0-9 _.\-()/#+:,]+$/;
      for (const key of ["name", "title", "device_name"]) {
        if (bodyObj[key] && typeof bodyObj[key] === "string") {
          const trimmed = bodyObj[key].trim();
          if (trimmed && !nameRegex.test(trimmed)) {
            // Show global validation toast visually using the Toast component
            const toastContainer = document.createElement("div");
            document.body.appendChild(toastContainer);
            const root = ReactDOM.createRoot(toastContainer);
            const msg = `Validation Error`;
            const subtitle = `'${key}' contains invalid characters. Only letters, numbers, spaces, and safe punctuation are allowed.`;
            root.render(<Toast message={msg} subtitle={subtitle} type="error" onClose={() => {
              root.unmount();
              toastContainer.remove();
            }} />);
            setTimeout(() => {
              try { root.unmount(); toastContainer.remove(); } catch (e) {}
            }, 4500);
            
            // Reject gracefully returning a fake 400 response
            return Promise.resolve(new Response(JSON.stringify({ 
              success: false, 
              error: subtitle 
            }), {
              status: 400,
              statusText: 'Bad Request',
              headers: { 'Content-Type': 'application/json' }
            }));
          }
        }
      }
    } catch (e) {
      // Not JSON or parse error, ignore
    }
  }
 
  // Attach VMS JWT token to all VMS backend API calls (port 8000 or /api/ paths)
  if (typeof resource === 'string' && (resource.includes(':8000') || resource.includes('/api/'))) {
    const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
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
    const hadToken = Boolean((localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token")));
    
    if (hadToken) {
      localStorage.removeItem('miradorai_user');
      localStorage.removeItem('miradorai_token');
      localStorage.removeItem('miradorai_session_id');
      sessionStorage.removeItem('miradorai_user');
      sessionStorage.removeItem('miradorai_token');
      sessionStorage.removeItem('miradorai_session_id');
      window.location.href = '/';
    }
  }
 
  return response;
};
 
ReactDOM.createRoot(document.getElementById("root")).render(
  <App />
);