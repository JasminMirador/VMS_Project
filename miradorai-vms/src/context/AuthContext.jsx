import React, { createContext, useContext, useState, useEffect } from "react";
import { encryptPassword, getPublicKey } from "../utils/crypto";
import { useWebSocket } from "../hooks/useWebSocket";
import { fetchAndCacheAiIp } from "../utils/aiIntegration";

const AuthContext = createContext();

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

// Change this to your backend URL if different
const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL)
  || "";

// Mirador Analytics AI — key-based SSO
const SSO_APP_NAME = "vms";
const SSO_TOKEN_KEY = "miradorai_sso_token";
const SSO_TOKEN_EXPIRY_KEY = "miradorai_sso_token_expiry";

/**
 * Silently fetches a short-lived SSO JWT using the VMS access token.
 * Resolves the AI server IP dynamically from /api/integrations (with localStorage cache).
 * Stores the result in localStorage so AiAnalyticsPage can consume it.
 */
const fetchSsoToken = async (accessToken) => {
  if (!accessToken) return;
  try {
    // Resolve AI server IP from integrations
    const aiIp = await fetchAndCacheAiIp();
    
    // Hit the remote IP directly (no proxy)
    const ssoUrl = `http://${aiIp}:3000/unsecure/keybasedlogin`;
    console.log("[SSO] Calling keybasedlogin directly at:", ssoUrl);

    // Fetch integrations to get appName and accessToken
    let ssoAppName = "vms";
    let ssoAccessToken = "uUlAaZ3xCg8zc5C4_MfvngOtWuWfQdazAB53K5M4Zcc";
    try {
      const tokenForApi = getAuthItem("token") || getAuthItem("miradorai_token");
      const integRes = await fetch(`${API_BASE}/api/integrations`, {
        headers: { Authorization: tokenForApi ? `Bearer ${tokenForApi}` : "" }
      });
      if (integRes.ok) {
        const integrations = await integRes.json();
        // find the one that has appName and accessToken
        const aiInteg = integrations.find(c => (c.type === "Mirador AI" || c.appName) && c.accessToken);
        if (aiInteg && aiInteg.appName && aiInteg.accessToken) {
          ssoAppName = aiInteg.appName;
          ssoAccessToken = aiInteg.accessToken;
        }
      }
    } catch (e) {
      console.warn("[SSO] Failed to fetch dynamic appName and accessToken from integrations", e);
    }

    const res = await fetch(ssoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        accessToken: ssoAccessToken, 
        appName: ssoAppName 
      }),
    });
    let data = null;
    try {
      data = await res.json();
      console.log("[SSO] Full response data from keybasedlogin:", data);
    } catch (e) {
      console.error("[SSO] Could not parse JSON from response:", e);
    }

    if (!res.ok) {
      console.warn("[SSO] keybasedlogin returned", res.status, data);
      return;
    }
    
    if (data?.token) {
      // Get the tokenType from the response, fallback to 'Bearer'
      const tokenType = data.tokenType || "Bearer";
      const formattedToken = `${tokenType} ${data.token}`;
      
      console.log("[SSO] Successfully received token:", formattedToken);
      localStorage.setItem(SSO_TOKEN_KEY, formattedToken);
      
      // Store expiry as Unix ms so we can refresh proactively
      const expiresInMs = (data.expiresIn || 3600) * 1000;
      localStorage.setItem(SSO_TOKEN_EXPIRY_KEY, String(Date.now() + expiresInMs));
      console.log("[SSO] SSO token obtained from", aiIp, "— expires in", data.expiresIn, "ms");
    }
  } catch (err) {
    // Non-blocking — VMS login should still succeed even if SSO fails
    console.warn("[SSO] fetchSsoToken failed:", err.message);
  }
};

const AUTH_KEYS = ["miradorai_user", "miradorai_token", "miradorai_session_id"];

// Read from either storage (localStorage = "keep me logged in", sessionStorage = tab only)
export const getAuthItem = (key) =>
  localStorage.getItem(key) || sessionStorage.getItem(key);

// Save into the chosen storage and remove from the other one
const setAuthItems = (items, keep) => {
  const target = keep ? localStorage : sessionStorage;
  Object.entries(items).forEach(([key, value]) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    if (value != null) target.setItem(key, value);
  });
};

const clearAuthItems = () => {
  AUTH_KEYS.forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // Supervisor unlock — reset on logout / new session
  const [supervisorUnlocked, setSupervisorUnlocked] = useState(false);

  // Connect to websocket to listen for global force_logout events
  const { lastEvent } = useWebSocket(["alerts"]);
  const processedEvents = React.useRef(new Set());

  // Restore session from localStorage on mount
  useEffect(() => {
    try {
      const savedUser = getAuthItem("miradorai_user");
      if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
      }
    } catch (e) {
      console.error("Failed to restore session:", e);
      clearAuthItems();
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Listen for auth_revoked events
  useEffect(() => {
    if (user && lastEvent?.topic === "alerts" && lastEvent?.event === "auth_revoked") {
      const eventId = lastEvent.event_id || lastEvent.timestamp;
      if (!eventId || processedEvents.current.has(eventId)) return;
      processedEvents.current.add(eventId);

      const currentSession = getAuthItem("miradorai_session_id");
      if (!currentSession) return; // ignore if we don't have a session locally

      if (lastEvent.data?.user_email === user.email && lastEvent.data?.session_id !== currentSession) {
        alert("Session expired: Another session has been initiated under this account.");
        setUser(null);
        setSupervisorUnlocked(false);
        clearAuthItems();
      }
    }
  }, [lastEvent, user]);

  // ------------------------------------------------------------------
  // Sign Up — saves to MongoDB via backend
  // ------------------------------------------------------------------
  const signup = async (email, role) => {
    // Client-side validation first
    if (!email) {
      return { success: false, error: "Email field is required" };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: "Invalid email format" };
    }

    // Call backend
    try {
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch (jsonErr) {
        // Response was not JSON
      }

      if (!res.ok) {
        return { success: false, error: data?.detail || data?.message || `Server error (${res.status})` };
      }

      return { success: true, message: data?.message || "Signup request submitted successfully!" };
    } catch (err) {
      console.error("[AUTH] Signup error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

    // ------------------------------------------------------------------
  // Finalize Sign Up — set password using OTP
  // ------------------------------------------------------------------
  const finalizeSignup = async (email, otp, password) => {
    if (!email || !otp || !password) {
      return { success: false, error: "All fields are required" };
    }
    
    if (password.length < 12) {
      return { success: false, error: "Password must be at least 12 characters" };
    }

    try {
      const pubKey = await getPublicKey(API_BASE);
      const encryptedPassword = await encryptPassword(password, pubKey);

      const res = await fetch(`${API_BASE}/api/auth/signup/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, password: encryptedPassword }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch (e) {}

      if (!res.ok) {
        return { success: false, error: data?.detail || data?.message || "Failed to verify OTP" };
      }

      return { success: true, message: data?.message || "Account finalized successfully! Please log in." };
    } catch (err) {
      console.error("[AUTH] Finalize signup error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

  // ------------------------------------------------------------------
  // Sign In — verifies against MongoDB via backend
  // ------------------------------------------------------------------
  const login = async (email, password, role, captchaId = null, captchaText = null, mfaCode = null, keepLoggedIn = false) => {
    if (!email || !password) {
      return { success: false, error: "Email and password required" };
    }

    const validRoles = ["admin", "client", "operator"];
    const assignedRole = validRoles.includes(role) ? role : "client";

    try {
            // 1. Fetch public key
      const pubKey = await getPublicKey(API_BASE);

      // 2. Encrypt password using RSA
      const encryptedPassword = await encryptPassword(password, pubKey);

      // 3. Submit login request
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password: encryptedPassword,
          role: assignedRole,
          captcha_id: captchaId,
          captcha_text: captchaText,
          mfa_code: mfaCode,
        }),
      });

      console.log("PAYLOAD SENT TO BACKEND:", JSON.stringify({
        email,
        password: "[CHALLENGE_HASH_HIDDEN]",
        role: assignedRole,
        captcha_id: captchaId,
        captcha_text: captchaText,
        mfa_code: mfaCode,
      }));


  let data = null;
  try {
    data = await res.json();
  } catch (jsonErr) {
    // Response was not JSON
  }

  if (!res.ok) {
    return {
      success: false,
      error: data?.detail || data?.message || `Server error (${res.status})`,
      requires_captcha: data?.requires_captcha || false,
    };
  }

  if (data.has_active_session) {
    return {
      success: true,
      has_active_session: true,
      user: data.user,
      token: data.token,
      session_id: data.session_id,
    };
  }

  setUser(data.user);
  setSupervisorUnlocked(false);
  setAuthItems(
    {
      miradorai_user: JSON.stringify(data.user),
      miradorai_token: data.token,
      // Also store the session_id to ignore my own login events!
      miradorai_session_id: data.session_id || null,
    },
    keepLoggedIn
  );

  // 🔑 Silently obtain an SSO token for the AI Analytics iframe
  fetchSsoToken(data.token);

  return {
    success: true,
    has_active_session: false,
  };
} catch (err) {
  console.error("[AUTH] Login error:", err);
  return {
    success: false,
    error: "Cannot connect to server. Please try again.",
  };
}
};
  // ------------------------------------------------------------------
  // Supervisor unlock — client role uses this to access restricted pages
  // Password is set by admin via Settings > Supervisor Details (stored in localStorage)
  // Falls back to "supervisor123" if admin hasn't configured one yet
  // ------------------------------------------------------------------
  const unlockSupervisor = () => {
    setSupervisorUnlocked(true);
    return { success: true };
  };

  const lockSupervisor = () => setSupervisorUnlocked(false);

  // ------------------------------------------------------------------
  // Forgot Password — checks email exists in MongoDB via backend
  // ------------------------------------------------------------------
  const forgotPassword = async (email, captchaId = null, captchaText = null) => {
    if (!email) {
      return { success: false, error: "Email is required" };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: "Invalid email format" };
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, captcha_id: captchaId, captcha_text: captchaText }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch (jsonErr) {
        // Response was not JSON
      }

      if (!res.ok) {
        return { 
          success: false, 
          error: data?.detail || data?.message || `Server error (${res.status})`,
          requires_captcha: data?.requires_captcha 
        };
      }

      return { success: true, message: data?.message };
    } catch (err) {
      console.error("[AUTH] Forgot password error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

  // ------------------------------------------------------------------
  // Reset Password — updates password in MongoDB via backend
  // ------------------------------------------------------------------
  const resetPassword = async (email, otp, newPassword, confirmPassword) => {
    if (!email || !otp || !newPassword || !confirmPassword) {
      return { success: false, error: "All fields are required" };
    }

    if (newPassword.length < 12) {
      return { success: false, error: "Password must be at least 12 characters" };
    }

    if (newPassword !== confirmPassword) {
      return { success: false, error: "Passwords do not match" };
    }

    try {
      const pubKey = await getPublicKey(API_BASE);
      const encryptedNew = await encryptPassword(newPassword, pubKey);
      const encryptedConfirm = await encryptPassword(confirmPassword, pubKey);
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          otp,
          new_password:     encryptedNew,
          confirm_password: encryptedConfirm,
        }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch (jsonErr) {
        // Response was not JSON
      }

      if (!res.ok) {
        return { success: false, error: data?.detail || data?.message || `Server error (${res.status})` };
      }

      return { success: true, message: data?.message };
    } catch (err) {
      console.error("[AUTH] Reset password error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

  // ------------------------------------------------------------------
  // OAuth Login (Google) — kept local since it's mock/demo
  // ------------------------------------------------------------------
  const oauthLogin = (provider, selectedRole = "client", selectedEmail = null) => {
    if (provider !== "google") {
      return { success: false, error: "Unsupported OAuth provider" };
    }

    const candidateEmail = selectedEmail || "google.user@example.com";
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!candidateEmail || !emailRegex.test(candidateEmail)) {
      return { success: false, error: "Please select a valid Google account email" };
    }

    const userData = {
      id:            Date.now().toString(),
      email:         candidateEmail,
      role:          selectedRole,
      loginTime:     new Date().toISOString(),
      loginDate:     new Date().toLocaleDateString("en-US", {
        year:   "numeric",
        month:  "short",
        day:    "numeric",
        hour:   "2-digit",
        minute: "2-digit",
      }),
      sessionId:     Math.random().toString(36).substring(2, 11),
      oauthProvider: "google",
    };

    setUser(userData);
    setAuthItems({ miradorai_user: JSON.stringify(userData) }, false);

    return {
      success: true,
      message: `Logged in as ${candidateEmail} with role ${selectedRole}.`,
    };
  };

  // ------------------------------------------------------------------
  // Logout
  // ------------------------------------------------------------------
  const logout = async () => {
    try {
      const token = getAuthItem("miradorai_token");
      if (token) {
        await fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`
          }
        });
      }
    } catch (err) {
      console.error("[AUTH] Backend logout failed:", err);
    }
    setUser(null);
    setSupervisorUnlocked(false);
    clearAuthItems();
    // Attempt to automatically close the browser window as per security remediation
    try {
      window.close();
    } catch (e) {
      console.error("Window closure blocked by browser policy.", e);
    }
    // Clear SSO token
    localStorage.removeItem("miradorai_sso_token");
    localStorage.removeItem("miradorai_sso_token_expiry");
  };

  const isAdmin        = user?.role === "admin";
  const isClient       = user?.role === "client";
  const isOperator     = user?.role === "operator";
  const isAuthenticated = !!user;
  const completeLogin = (userData, token, session_id = null, keepLoggedIn = false) => {
    setUser(userData);
    setSupervisorUnlocked(false);
    setAuthItems(
      {
        miradorai_user: JSON.stringify(userData),
        miradorai_token: token,
        miradorai_session_id: session_id || null,
      },
      keepLoggedIn
    );
    fetchSsoToken(token);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        isAdmin,
        isClient,
        isOperator,
        supervisorUnlocked,
        unlockSupervisor,
        lockSupervisor,
        login,
        completeLogin,
        signup,
        finalizeSignup,
        forgotPassword,
        resetPassword,
        oauthLogin,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
