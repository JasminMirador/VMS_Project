import React, { createContext, useContext, useState, useEffect } from "react";
import { encryptPassword, getPublicKey } from "../utils/crypto";
import { useWebSocket } from "../hooks/useWebSocket";
import { apiUrl } from '../config/appConfig';

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

const AUTH_KEYS = ["miradorai_user", "miradorai_token", "miradorai_session_id"];

// Read auth item (always prefers localStorage, falls back to sessionStorage for legacy migration)
export const getAuthItem = (key) =>
  localStorage.getItem(key) || sessionStorage.getItem(key);

// Always save into localStorage and ensure sessionStorage is clean
const setAuthItems = (items) => {
  Object.entries(items).forEach(([key, value]) => {
    sessionStorage.removeItem(key);
    if (value != null) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  });
};

const clearAuthItems = () => {
  try {
    // Preserve harmless UI preferences (visual theme & language)
    const preserved = {
      miradorai_theme: localStorage.getItem("miradorai_theme"),
      mirador_language: localStorage.getItem("mirador_language"),
    };

    localStorage.clear();
    sessionStorage.clear();

    // Re-apply preserved preferences
    Object.entries(preserved).forEach(([key, val]) => {
      if (val !== null && val !== undefined) {
        localStorage.setItem(key, val);
      }
    });
  } catch (err) {
    console.error("[AUTH] Error clearing storage:", err);
  }
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

      if (lastEvent.data?.user_email === user.email) {
        const isAccountRemoved =
          lastEvent.data?.reason === "account_removed" ||
          (!lastEvent.data?.revoked_session_ids && lastEvent.data?.session_id == null);

        const isThisSessionRevoked =
          Array.isArray(lastEvent.data?.revoked_session_ids)
            ? lastEvent.data.revoked_session_ids.includes(currentSession)
            : (lastEvent.data?.session_id && lastEvent.data.session_id !== currentSession);

        if (isAccountRemoved || isThisSessionRevoked) {
          alert(
            isAccountRemoved
              ? "Your account has been removed or is no longer active. You have been logged out."
              : "Session expired: Another session has been initiated under this account."
          );
          setUser(null);
          setSupervisorUnlocked(false);
          clearAuthItems();
          window.location.href = "/login";
        }
      }
    }
  }, [lastEvent, user]);

  // Clear everything locally (no backend call; the account may already be gone)
  const forceLogoutLocal = React.useCallback((message) => {
    setUser(null);
    setSupervisorUnlocked(false);
    clearAuthItems();
    if (message) alert(message);
    window.location.href = "/login";
  }, []);

  // Verify the session with the backend on load, on tab focus, and every 60s
  useEffect(() => {
    if (!user) return;
    const token = getAuthItem("miradorai_token");
    if (!token) return; // mock OAuth users have no backend token

    let cancelled = false;
    const verify = async () => {
      try {
        const res = await fetch(apiUrl('/auth/me'), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const isJson = (res.headers.get("content-type") || "").includes("application/json");
        if (!cancelled && (res.status === 401 || res.status === 403 || (res.ok && !isJson))) {
          forceLogoutLocal("Your account is no longer active. You have been logged out.");
        }
      } catch (e) {
        // Network error: don't log anyone out
      }
    };

    verify();
    const id = setInterval(verify, 60000);
    window.addEventListener("focus", verify);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", verify);
    };
  }, [user, forceLogoutLocal]);

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
      const res = await fetch(apiUrl('/auth/signup'), {
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
        return { success: false, error: data?.error || data?.detail || data?.message || `Server error (${res.status})` };
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
      const pubKey = await getPublicKey();
      const encryptedPassword = await encryptPassword(password, pubKey);

      const res = await fetch(apiUrl('/auth/signup/finalize'), {
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
  // Sign Up with password — password is RSA-encrypted like login/reset
  // ------------------------------------------------------------------
  const signupWithPassword = async (email, role, password, confirmPassword) => {
    if (!email || !password || !confirmPassword) {
      return { success: false, error: "All fields are required" };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, error: "Invalid email format" };
    }

    if (password.length < 12) {
      return { success: false, error: "Password must be at least 12 characters" };
    }

    if (password !== confirmPassword) {
      return { success: false, error: "Passwords do not match" };
    }

    try {
      const pubKey = await getPublicKey();
      const encryptedPassword = await encryptPassword(password, pubKey);
      const encryptedConfirm = await encryptPassword(confirmPassword, pubKey);

      const res = await fetch(apiUrl('/auth/signup/password'), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role,
          password: encryptedPassword,
          confirm_password: encryptedConfirm,
        }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch (e) {}

      if (!res.ok) {
        return { success: false, error: data?.detail || data?.message || `Server error (${res.status})` };
      }

      return { success: true, message: data?.message || "Account created successfully. Please log in." };
    } catch (err) {
      console.error("[AUTH] Password signup error:", err);
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
      const pubKey = await getPublicKey();

      // 2. Encrypt password using RSA
      const encryptedPassword = await encryptPassword(password, pubKey);

      // 3. Submit login request
      const res = await fetch(apiUrl('/auth/login'), {
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
    let errorMsg = `Server error (${res.status})`;
    if (data?.error) {
      errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    } else if (data?.detail) {
      errorMsg = typeof data.detail === 'string' ? data.detail : (Array.isArray(data.detail) ? data.detail[0].msg : JSON.stringify(data.detail));
    } else if (data?.message) {
      errorMsg = typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
    }

    return {
      success: false,
      error: errorMsg,
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
      const res = await fetch(apiUrl('/auth/forgot-password'), {
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
          error: data?.error || data?.detail || data?.message || `Server error (${res.status})`,
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
      const pubKey = await getPublicKey();
      const encryptedNew = await encryptPassword(newPassword, pubKey);
      const encryptedConfirm = await encryptPassword(confirmPassword, pubKey);
      const res = await fetch(apiUrl('/auth/reset-password'), {
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
        return { success: false, error: data?.error || data?.detail || data?.message || `Server error (${res.status})` };
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
        await fetch(apiUrl('/auth/logout'), {
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
    // Cleanly redirect to root / login page
    window.location.href = "/login";
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
        signupWithPassword,
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
