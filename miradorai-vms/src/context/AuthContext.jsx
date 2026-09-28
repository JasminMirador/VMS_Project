import React, { createContext, useContext, useState, useEffect } from "react";
import { useWebSocket } from "../hooks/useWebSocket";
import { encryptPassword, getPublicKey } from "../utils/crypto";

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
      const savedUser = localStorage.getItem("miradorai_user");
      if (savedUser) {
        const parsedUser = JSON.parse(savedUser);
        setUser(parsedUser);
      }
    } catch (e) {
      console.error("Failed to restore session:", e);
      localStorage.removeItem("miradorai_user");
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

      const currentSession = localStorage.getItem("miradorai_session_id");
      if (!currentSession) return; // ignore if we don't have a session locally

      if (lastEvent.data?.user_email === user.email && lastEvent.data?.session_id !== currentSession) {
        alert("Session expired: Another session has been initiated under this account.");
        setUser(null);
        setSupervisorUnlocked(false);
        localStorage.removeItem("miradorai_user");
        localStorage.removeItem("miradorai_token");
        localStorage.removeItem("miradorai_session_id");
      }
    }
  }, [lastEvent, user]);

  // ------------------------------------------------------------------
  // Sign Up — saves to MongoDB via backend
  // ------------------------------------------------------------------
  const signup = async (email, password, passwordConfirm, role) => {
    // Client-side validation first
    if (!email || !password || !passwordConfirm) {
      return { success: false, error: "All fields are required" };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: "Invalid email format" };
    }

    if (password.length < 6) {
      return { success: false, error: "Password must be at least 6 characters" };
    }

    if (password !== passwordConfirm) {
      return { success: false, error: "Passwords do not match" };
    }

    try {
      const pubKey = await getPublicKey(API_BASE);
      const encryptedPassword = await encryptPassword(password, pubKey);
      
      const res = await fetch(`${API_BASE}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: encryptedPassword, role }),
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

      return { success: true, message: data?.message || "Account created successfully!" };
    } catch (err) {
      console.error("[AUTH] Signup error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

  // ------------------------------------------------------------------
  // Sign In — verifies against MongoDB via backend
  // ------------------------------------------------------------------
  const login = async (email, password, role, captchaId = null, captchaText = null, mfaCode = null) => {
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
  localStorage.setItem("miradorai_user", JSON.stringify(data.user));
  localStorage.setItem("miradorai_token", data.token);
  // Also store the session_id to ignore my own login events!
  if (data.session_id) localStorage.setItem("miradorai_session_id", data.session_id);

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
  const forgotPassword = async (email) => {
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
        body: JSON.stringify({ email }),
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
      console.error("[AUTH] Forgot password error:", err);
      return { success: false, error: "Cannot connect to server. Please try again." };
    }
  };

  // ------------------------------------------------------------------
  // Reset Password — updates password in MongoDB via backend
  // ------------------------------------------------------------------
  const resetPassword = async (email, newPassword, confirmPassword) => {
    if (!email || !newPassword || !confirmPassword) {
      return { success: false, error: "All fields are required" };
    }

    if (newPassword.length < 6) {
      return { success: false, error: "Password must be at least 6 characters" };
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
    localStorage.setItem("miradorai_user", JSON.stringify(userData));

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
      const token = localStorage.getItem("miradorai_token");
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
    localStorage.removeItem("miradorai_user");
    localStorage.removeItem("miradorai_token");
    localStorage.removeItem("miradorai_session_id");

    // Attempt to automatically close the browser window as per security remediation
    try {
      window.close();
    } catch (e) {
      console.error("Window closure blocked by browser policy.", e);
    }
  };

  const isAdmin        = user?.role === "admin";
  const isClient       = user?.role === "client";
  const isOperator     = user?.role === "operator";
  const isAuthenticated = !!user;
  const completeLogin = (userData, token, session_id = null) => {
    setUser(userData);
    setSupervisorUnlocked(false);
    localStorage.setItem("miradorai_user", JSON.stringify(userData));
    localStorage.setItem("miradorai_token", token);
    if (session_id) localStorage.setItem("miradorai_session_id", session_id);
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
