import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

// Global Fetch Interceptor to attach JWT token
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;

  // Apply only to API calls
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

  const response = await originalFetch(resource, config);

  // Handle unauthorized responses globally
  if (response.status === 401 && !resource.includes('/api/auth/')) {
    console.warn("Unauthorized API call:", resource);
    const hadToken = Boolean(localStorage.getItem('miradorai_token'));
    localStorage.removeItem('miradorai_user');
    localStorage.removeItem('miradorai_token');
    localStorage.removeItem('miradorai_session_id');

    // Only force redirect if there was an active token and user is on a protected route
    if (hadToken && window.location.pathname !== '/' && window.location.pathname !== '/login') {
      window.location.href = '/';
    }
  }

  return response;
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <App />
);
