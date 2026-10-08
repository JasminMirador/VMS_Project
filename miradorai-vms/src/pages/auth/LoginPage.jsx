import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import "./LoginPage.css";
import useActivityLogger from "../../hooks/useActivityLogger";
import logo from "../../assets/logo.jpg";

const PASSWORD_RULES = [
  { label: "At least 12 characters long", test: p => p.length >= 12 },
  { label: "One uppercase letter", test: p => /[A-Z]/.test(p) },
  { label: "One lowercase letter", test: p => /[a-z]/.test(p) },
  { label: "One number", test: p => /[0-9]/.test(p) },
  { label: "One special character", test: p => /[!@#$%^&*(),.?":{}|<>]/.test(p) }
];

const isStrongPassword = (p) => PASSWORD_RULES.every(r => r.test(p || ""));


const EyeIcon = ({ open }) =>
  open ? (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
  ) : (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  );

const PasswordRules = ({ password }) => {
  const rules = PASSWORD_RULES;

  return (
    <div className="password-rules">
      {rules.map((rule, idx) => {
        const passed = rule.test(password || "");
        return (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', marginBottom: '4px', color: passed ? '#0f9d58' : '#9aa5b1' }}>
            {passed ? (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: '6px' }}><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" style={{ marginRight: '6px' }}><circle cx="12" cy="12" r="10"/></svg>
            )}
            <span>{rule.label}</span>
          </div>
        )
      })}
    </div>
  );
};

const STRENGTH_LABELS = ["", "Very weak", "Weak", "Fair", "Good", "Strong"];

const PasswordStrength = ({ password }) => {
  const pw = password || "";
  const total = PASSWORD_RULES.length;
  const passed = PASSWORD_RULES.filter(r => r.test(pw)).length;

  if (!pw) return null;

  return (
    <div className="pw-strength" data-level={passed}>
      <div className="pw-bars">
        {PASSWORD_RULES.map((_, i) => (
          <span key={i} className={`pw-bar ${i < passed ? "on" : ""}`} />
        ))}
      </div>

      <div className="pw-meta">
        <span className="pw-level">{STRENGTH_LABELS[passed]}</span>
        <span className="pw-count">{passed}/{total} requirements</span>
      </div>

      {passed < total && (
        <div className="pw-rules">
          {PASSWORD_RULES.map((rule, idx) => {
            const ok = rule.test(pw);
            return (
              <div key={idx} className={`pw-rule ${ok ? "ok" : ""}`}>
                <span className="pw-rule-icon">{ok ? "✓" : "○"}</span>
                {rule.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// Password show/hide toggle with a real accessible name (icon-only button)
const PasswordToggle = ({ visible, onClick, disabled }) => (
  <button
    type="button"
    className="password-toggle"
    onClick={onClick}
    disabled={disabled}
    aria-label={visible ? "Hide password" : "Show password"}
    aria-pressed={visible}
  >
    {visible ? (
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    ) : (
      <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
    )}
  </button>
);

// Small line icons used as input prefixes / decoration — plain hand-drawn
// outline glyphs (mail / lock / arrow / shield / check), not tied to any
// icon library, so they carry no extra dependency.
const MailIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="M3.5 6.5 12 13l8.5-6.5" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
    <path d="M7.5 10.5v-3a4.5 4.5 0 0 1 9 0v3" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="12" x2="20" y2="12" />
    <polyline points="13 5 20 12 13 19" />
  </svg>
);


const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9.5" />
    <line x1="12" y1="11" x2="12" y2="16.5" />
    <circle cx="12" cy="7.5" r="0.75" fill="currentColor" stroke="none" />
  </svg>
);

// Primary auth-flow button — flat, solid accent, trailing arrow. Replaces
// the previous WebGL "specular" button, which was styled for a dark canvas
// and doesn't read well on this light card.
const AuthButton = ({ children, disabled, type = "submit", onClick, className = "" }) => (
  <button type={type} className={`auth-btn ${className}`} disabled={disabled} onClick={onClick}>
    <span>{children}</span>
    {!disabled && <ArrowIcon />}
  </button>
);

// Left-hand brand / marketing panel. Hidden on narrow viewports so the
// form always gets the full, fluid width of the screen.
const BrandPanel = () => (
  <div className="brand-panel" aria-hidden="true">
    <div className="brand-panel-inner">
      <div className="brand-panel-top">
        <div className="brand-panel-logo">
          <img src={logo} alt="" />
        </div>
        <div>
          <div className="brand-panel-name">Mirador VMS</div>
          <div className="brand-panel-sub">Video, access &amp; operations platform</div>
        </div>
      </div>

      <span className="brand-badge">Unified security operations</span>

      <h1 className="brand-headline">
        One console for video, access &amp; site operations.
      </h1>
      <p className="brand-copy">
        Sign in to monitor live feeds, manage access control, and coordinate
        maintenance across every site — as an admin, client, or operator.
      </p>

      <ul className="brand-checklist">
        <li><span className="brand-check"><CheckIcon /></span>Real-time monitoring across every site</li>
        <li><span className="brand-check"><CheckIcon /></span>Role-based access for admins, clients &amp; operators</li>
        <li><span className="brand-check"><CheckIcon /></span>Built for enterprise-scale security teams</li>
      </ul>

      <div className="brand-panel-footer">© {new Date().getFullYear()} Mirador VMS</div>
    </div>
  </div>
);

const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL)

const LoginPage = () => {
  const { login, completeLogin, signup, signupWithPassword, finalizeSignup, forgotPassword, resetPassword } = useAuth();
  const { theme } = useTheme();
  const [activeForm, setActiveForm] = useState("signin"); // "signin" | "forgot" | "signup"
  const [role, setRole] = useState("admin");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPasswordHint, setShowPasswordHint] = useState(false);
  const [showVerifyHint, setShowVerifyHint] = useState(false);
  const { logAction } = useActivityLogger();

  // Smoothly scale the whole login screen with the window width so it isn't
  // tiny on large monitors. Browser zoom changes innerWidth too, so the page
  // looks the same size at any browser zoom level (no jumps between steps).
  const [uiZoom, setUiZoom] = useState(() =>
    Math.min(2.5, Math.max(1, (typeof window !== "undefined" ? window.innerWidth : 0) / 1600))
  );
  useEffect(() => {
    const update = () => setUiZoom(Math.min(2.5, Math.max(1, window.innerWidth / 1600)));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    // Log pre-authentication site visit
    fetch(`${API_BASE}/api/auth/visit`, { method: 'POST' }).catch(() => {});
  }, []);

  useEffect(() => {
    // Reset CAPTCHA state when switching forms to prevent state leakage
    setRobotChecked(false);
    setCaptchaText("");
    if (activeForm !== "forgot") {
      setRequiresCaptcha(false);
    }
  }, [activeForm]);

  // Sign In Form
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [activeSessionWarning, setActiveSessionWarning] = useState(null);
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);
  const signInPasswordRef = useRef(null);

  // After a failed login the password is cleared; put the cursor back in it
  useEffect(() => {
    if (signInError && !isLoading && !signInPassword) {
      signInPasswordRef.current?.focus();
    }
  }, [signInError, isLoading, signInPassword]);

  // MFA Form
  const [showMfaInput, setShowMfaInput] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  // Forced Password Change Form
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  // Sign Up Form
  const [signUpEmail, setSignUpEmail] = useState(localStorage.getItem("pendingSignupEmail") || "");
  const [signUpError, setSignUpError] = useState("");
  const [signUpSuccess, setSignUpSuccess] = useState("");
  const [signUpMethod, setSignUpMethod] = useState("password"); // "password" | "otp"
  const [signUpPassword, setSignUpPassword] = useState("");
  const [signUpConfirm, setSignUpConfirm] = useState("");

   // Verify OTP Form
  const [verifyOtp, setVerifyOtp] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyConfirm, setVerifyConfirm] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [verifySuccess, setVerifySuccess] = useState("");
  const [isResending, setIsResending] = useState(false);

  // Forgot Password Form
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotStep, setForgotStep] = useState("email");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [forgotSuccess, setForgotSuccess] = useState("");
  const [requiresCaptcha, setRequiresCaptcha] = useState(false);
  const [captchaId, setCaptchaId] = useState(null);
  const [captchaText, setCaptchaText] = useState("");
  const [captchaImageBase64, setCaptchaImageBase64] = useState("");
  const [robotChecked, setRobotChecked] = useState(false);

  const fetchCaptcha = async () => {
    try {
      const res = await fetch("/api/auth/captcha");
      const data = await res.json();
      setCaptchaId(data.captcha_id);
      setCaptchaImageBase64(data.image_base64);
      setCaptchaText("");
    } catch (err) {
      console.error("Failed to fetch CAPTCHA", err);
    }
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    setSignInError("");
    setActiveSessionWarning(null);
    setIsLoading(true);

    if (requiresCaptcha && (!robotChecked || !captchaId || !captchaText)) {
      setSignInError("Please verify you are not a robot and enter the CAPTCHA text");
      setIsLoading(false);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    console.log("CALLING LOGIN WITH MFA CODE:", mfaCode);
    const result = await login(signInEmail, signInPassword, role, captchaId, captchaText, mfaCode, keepLoggedIn);

    if (!result.success) {
      if (result.error === "PASSWORD_CHANGE_REQUIRED") {
        setShowChangePassword(true);
        setIsLoading(false);
        return;
      }
      if (result.error === "MFA_REQUIRED") {
        setShowMfaInput(true);
        setSignInError(""); // clear error for MFA screen
        setIsLoading(false);
        return;
      }

      setSignInError(result.error);
      if (showMfaInput) {
        setMfaCode("");          // wrong MFA code: clear only the code
      } else {
        setSignInPassword("");   // wrong password: clear it
        setShowPassword(false);
      }
      if (result.requires_captcha) {
        setRequiresCaptcha(true);
        if (!captchaImageBase64) {
          fetchCaptcha();
        } else if (captchaId) {
           // Refetch captcha on failure if it's already showing
           fetchCaptcha();
        }
      }
      setIsLoading(false);
      return;
    }

    if (result.has_active_session) {
      setActiveSessionWarning({ user: result.user, token: result.token, session_id: result.session_id });
      setIsLoading(false);
      return;
    }

    // Reset CAPTCHA on success
    setRequiresCaptcha(false);
    setCaptchaId(null);
    setCaptchaText("");
    setRobotChecked(false);

    // 🔥 Activity log — user logged in
    logAction("User logged in", "auth", { email: signInEmail });

    setIsLoading(false);
  };

    const handleForcedPasswordChange = async (e) => {
    e.preventDefault();
    setSignInError("");
    setIsLoading(true);

    if (newPassword !== confirmNewPassword) {
      setSignInError("New passwords do not match");
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: signInEmail,
          old_password: signInPassword,
          new_password: newPassword,
          confirm_password: confirmNewPassword
        })
      });
      const data = await res.json();

      if (!res.ok) {
        setSignInError((typeof data.detail === "string" ? data.detail : (Array.isArray(data.detail) ? data.detail.map(d => d.msg || "Invalid input").join(", ") : (data.message || "Failed to change password"))));
        setIsLoading(false);
        return;
      }

      // Password changed! Switch back to normal login and auto-login or just clear state
      setShowChangePassword(false);
      setSignInPassword(newPassword); // auto-fill new password
      setNewPassword("");
      setConfirmNewPassword("");
      setSignInError("Password changed successfully. Please sign in again.");
      setIsLoading(false);
    } catch (err) {
      setSignInError("Network error. Please try again.");
      setIsLoading(false);
    }
  };
  const handleSignUp = async (e) => {
    e.preventDefault();
    setSignUpError("");
    setSignUpSuccess("");
    setIsLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 500));



    // ---- Password sign up (default) ----
    if (signUpMethod === "password") {
      if (!isStrongPassword(signUpPassword)) {
        setSignUpError("Password does not meet all the requirements");
        setIsLoading(false);
        return;
      }
      if (signUpPassword !== signUpConfirm) {
        setSignUpError("Passwords do not match");
        setIsLoading(false);
        return;
      }

      const createdEmail = signUpEmail.trim();
      const result = await signupWithPassword(createdEmail, "admin", signUpPassword, signUpConfirm);

      if (!result.success) {
        setSignUpError(result.error);
      } else {
        setSignUpSuccess(result.message);
        logAction("User signed up with password", "auth", { email: createdEmail });
        setTimeout(() => {
          setActiveForm("signin");
          setSignInEmail(createdEmail);
          setSignUpEmail("");
          setSignUpPassword("");
          setSignUpConfirm("");
          setSignUpSuccess("");
        }, 3000);
      }
      setIsLoading(false);
      return;
    }

    // ---- OTP sign up ----
    const result = await signup(signUpEmail, "admin");
    if (!result.success) {
      setSignUpError(result.error);
    } else {
      setSignUpSuccess(result.message);
      logAction("User requested signup", "auth", { email: signUpEmail });
      localStorage.setItem("pendingSignupEmail", signUpEmail);
      setTimeout(() => {
        setActiveForm("verify");
      }, 3000);
    }
    setIsLoading(false);
  };

  const handleResendOtp = async () => {
    const emailToVerify = signUpEmail.trim();
    if (!emailToVerify) {
      setVerifyError("Please enter your email first");
      return;
    }

    setIsResending(true);
    setVerifyError("");
    setVerifySuccess("");
    try {
      const res = await fetch("/api/auth/signup/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailToVerify })
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError((typeof data.detail === "string" ? data.detail : (Array.isArray(data.detail) ? data.detail.map(d => d.msg || "Invalid input").join(", ") : ("Failed to resend OTP"))));
      } else {
        setVerifySuccess(data.message || "OTP resent successfully");
      }
    } catch (err) {
      setVerifyError("Network error. Could not resend OTP.");
    } finally {
      setIsResending(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setVerifyError("");
    setVerifySuccess("");
    setIsLoading(true);

    if (verifyPassword !== verifyConfirm) {
      setVerifyError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    // If they navigated directly, signUpEmail might be empty, so we should allow them to type it in.
    const emailToVerify = signUpEmail.trim();
    if (!emailToVerify) {
      setVerifyError("Please enter your email");
      setIsLoading(false);
      return;
    }

    const result = await finalizeSignup(emailToVerify, verifyOtp, verifyPassword);
    if (!result.success) {
      setVerifyError(result.error);
    } else {
      setVerifySuccess(result.message);
      logAction("User finalized signup", "auth", { email: emailToVerify });
      localStorage.removeItem("pendingSignupEmail");
      setTimeout(() => {
        setActiveForm("signin");
        setSignInEmail(emailToVerify);
        setSignUpEmail("");
        setVerifyOtp("");
        setVerifyPassword("");
        setVerifyConfirm("");
        setVerifySuccess("");
      }, 3000);
    }
    setIsLoading(false);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setForgotError("");
    setForgotSuccess("");
    setIsLoading(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    if (forgotStep === "email") {
      if (requiresCaptcha && (!robotChecked || !captchaId || !captchaText)) {
        setForgotError("Please verify you are not a robot and enter the CAPTCHA text");
        setIsLoading(false);
        return;
      }

      const result = await forgotPassword(forgotEmail, captchaId, captchaText);
      if (!result.success) {
        if (result.requires_captcha) {
          setRequiresCaptcha(true);
          fetchCaptcha();
        }
        setForgotError(result.error);
        setIsLoading(false);
        return;
      }

      setForgotSuccess(result.message);
      setForgotStep("reset");
      setRequiresCaptcha(false);
      setCaptchaId(null);
      setCaptchaText("");
      setIsLoading(false);
    } else {
      const result = await resetPassword(forgotEmail, resetOtp, resetNewPassword, resetConfirm);
      if (!result.success) {
        setForgotError(result.error);
        setIsLoading(false);
        return;
      }

      setForgotSuccess(result.message);
      setForgotEmail("");
      setResetOtp("");
      setResetNewPassword("");
      setResetConfirm("");
      setForgotStep("email");
      setIsLoading(false);

      setTimeout(() => {
        setActiveForm("signin");
        setForgotSuccess("");
      }, 2000);
    }
  };

  const eyebrow =
    activeForm === "signup" ? "GET STARTED" :
    showChangePassword ? "ACTION REQUIRED" :
    showMfaInput ? "VERIFY IT'S YOU" :
    "WELCOME BACK";

  return (
    <div className="login-page" style={{ "--ui-zoom": uiZoom }}>
      <div className="login-shell">
        <BrandPanel />

        <div className="form-panel">
          <div className="login-container">
            {/* Logo/Title */}
            <div className="login-header">
              <span className="login-eyebrow">{eyebrow}</span>
              <h1 className="login-title">
                {activeForm === "signin" && "Log in to Mirador VMS"}
                {activeForm === "forgot" && "Reset Password"}
                {activeForm === "signup" && "Create your account"}
              </h1>
              <p className="login-subtitle">
                {activeForm === "signin" && "Use your credentials to access the console."}
                {activeForm === "signup" && "Set up access for your team in a few seconds."}
                {activeForm === "forgot" && "We'll help you get back in."}
              </p>
            </div>

            {/* Sign In Form */}
            {activeForm === "signin" && showChangePassword && (
              <form onSubmit={handleForcedPasswordChange} className="auth-form">
                <p className="auth-form-note">Your account requires a password change.</p>
                <div className="form-group">
                  <label htmlFor="fpc-new-password">New Password</label>
                  <div className="input-with-icon password-input-wrapper">
                    <span className="input-icon"><LockIcon /></span>
                    <input id="fpc-new-password" type={showPassword ? "text" : "password"} placeholder="Enter new password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={isLoading} required />
                    <PasswordToggle visible={showPassword} disabled={isLoading} onClick={() => setShowPassword(!showPassword)} />
                  </div>
                  <PasswordRules password={newPassword} />
                </div>
                <div className="form-group">
                  <label htmlFor="fpc-confirm-password">Confirm Password</label>
                  <div className="input-with-icon password-input-wrapper">
                    <span className="input-icon"><LockIcon /></span>
                    <input id="fpc-confirm-password" type={showConfirmPassword ? "text" : "password"} placeholder="Confirm password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} disabled={isLoading} required />
                    <PasswordToggle visible={showConfirmPassword} disabled={isLoading} onClick={() => setShowConfirmPassword(!showConfirmPassword)} />
                  </div>
                </div>
                {signInError && <div className="error-message">{signInError}</div>}
                {activeSessionWarning && (
                  <div className="warning-message">
                    <p>This user already has an active session on another device.</p>
                    <div className="warning-message-actions">
                      <button type="button" className="btn-ghost-sm" onClick={() => setActiveSessionWarning(null)}>Cancel</button>
                      <button
                        type="button"
                        className="btn-tint-sm"
                        onClick={() => {
                          completeLogin(activeSessionWarning.user, activeSessionWarning.token, activeSessionWarning.session_id);
                          logAction("User logged in (concurrent)", "auth", { email: signInEmail });
                        }}
                      >
                        Continue Anyway
                      </button>
                    </div>
                  </div>
                )}

                <AuthButton disabled={isLoading || !newPassword || !confirmNewPassword}>
                  {isLoading ? "Updating..." : "Change Password"}
                </AuthButton>
                <button type="button" onClick={() => setShowChangePassword(false)} className="link-btn" style={{ marginTop: '16px', display: 'block', width: '100%', textAlign: 'center' }}>Cancel</button>
              </form>
            )}

            {activeForm === "signin" && showMfaInput && (
              <form onSubmit={handleSignIn} className="auth-form">
                <p className="auth-form-note">Two-Factor Authentication is enabled on this account.</p>
                <div className="form-group">
                  <label htmlFor="mfa-code">Authenticator Code</label>
                  <input id="mfa-code" type="text" placeholder="6-digit code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} disabled={isLoading} required maxLength="6" />
                </div>
                {signInError && <div className="error-message">{signInError}</div>}
                {activeSessionWarning && (
                  <div className="warning-message">
                    <p>This user already has an active session on another device.</p>
                    <div className="warning-message-actions">
                      <button type="button" className="btn-ghost-sm" onClick={() => setActiveSessionWarning(null)}>Cancel</button>
                      <button
                        type="button"
                        className="btn-tint-sm"
                        onClick={() => {
                          completeLogin(activeSessionWarning.user, activeSessionWarning.token, activeSessionWarning.session_id);
                          logAction("User logged in (concurrent)", "auth", { email: signInEmail });
                        }}
                      >
                        Continue Anyway
                      </button>
                    </div>
                  </div>
                )}

                <AuthButton disabled={isLoading || !mfaCode || mfaCode.length < 6}>
                  {isLoading ? "Verifying..." : "Verify"}
                </AuthButton>
                <button type="button" onClick={() => setShowMfaInput(false)} className="link-btn" style={{ marginTop: '16px', display: 'block', width: '100%', textAlign: 'center' }}>Cancel</button>
              </form>
            )}

            {activeForm === "signin" && !showChangePassword && !showMfaInput && (
              <form onSubmit={handleSignIn} className="auth-form">
                {/* Role Selection */}
                <div className="role-selector">
                  <label className="role-label">Login as</label>
                  <div className="role-options">
                    <button type="button" className={`role-option ${role === "admin" ? "active" : ""}`} onClick={() => setRole("admin")}>Admin</button>
                    <button type="button" className={`role-option ${role === "client" ? "active" : ""}`} onClick={() => setRole("client")}>Client</button>
                    <button type="button" className={`role-option ${role === "operator" ? "active" : ""}`} onClick={() => setRole("operator")}>Operator</button>
                  </div>
                </div>

                {/* Email Input */}
                <div className="form-group">
                  <label htmlFor="signin-email">Email address</label>
                  <div className="input-with-icon">
                    <span className="input-icon"><MailIcon /></span>
                    <input
                      id="signin-email"
                      type="email"
                      placeholder="you@company.com"
                      value={signInEmail}
                      onChange={(e) => setSignInEmail(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>

                {/* Password Input */}
            <div className="form-group">
              <div className="password-header">
                <label>Password</label>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setActiveForm("forgot");
                    setForgotEmail("");
                    setForgotStep("email");
                    setRequiresCaptcha(true);
                    fetchCaptcha();
                  }}
                  className="forgot-link"
                >
                  Forgot password?
                </a>
              </div>
              <div className="password-input-wrapper">
                <input
                  ref={signInPasswordRef}
                  type={showPassword ? "text" : "password"}
                  placeholder="Type your password"
                  value={signInPassword}
                  onChange={(e) => {
                    setSignInPassword(e.target.value);
                    if (signInError) setSignInError("");
                  }}
                  disabled={isLoading}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
            </div>

                {activeSessionWarning && (
                  <div className="warning-message">
                    <p>This user already has an active session on another device.</p>
                    <div className="warning-message-actions">
                      <button type="button" className="btn-ghost-sm" onClick={() => setActiveSessionWarning(null)}>Cancel</button>
                      <button
                        type="button"
                        className="btn-tint-sm"
                        onClick={() => {
                          completeLogin(activeSessionWarning.user, activeSessionWarning.token, activeSessionWarning.session_id);
                          logAction("User logged in (concurrent)", "auth", { email: signInEmail });
                        }}
                      >
                        Continue Anyway
                      </button>
                    </div>
                  </div>
                )}

                {/* Keep me logged in */}
                <label className="remember-me-row">
                  <input
                    type="checkbox"
                    checked={keepLoggedIn}
                    onChange={(e) => setKeepLoggedIn(e.target.checked)}
                    disabled={isLoading}
                  />
                  <span>Keep me logged in on this device</span>
                </label>

                {/* CAPTCHA */}
                {requiresCaptcha && (
                  <div className="form-group captcha-group">
                    <div className="captcha-robot-row">
                      <input
                        type="checkbox"
                        id="robotCheck"
                        checked={robotChecked}
                        onChange={(e) => setRobotChecked(e.target.checked)}
                      />
                      <label htmlFor="robotCheck" className="captcha-robot-label">I'm not a robot</label>
                      <img src="https://www.gstatic.com/recaptcha/api2/logo_48.png" alt="captcha icon" style={{ width: '28px', opacity: 0.6 }} />
                    </div>

                    {robotChecked && captchaImageBase64 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <img src={captchaImageBase64} alt="CAPTCHA" className="captcha-image" />
                          <button
                            type="button"
                            onClick={fetchCaptcha}
                            className="btn-secondary captcha-reload"
                            title="Reload CAPTCHA"
                          >
                            ↻
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="Enter the letters above"
                          value={captchaText}
                          onChange={(e) => setCaptchaText(e.target.value)}
                          disabled={isLoading}
                          required={robotChecked}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Error */}
                {signInError && <div className="error-message">{signInError}</div>}

                {/* Sign In Button */}
                <AuthButton disabled={isLoading || !signInEmail || !signInPassword}>
                  {isLoading ? "Signing in..." : "Log in"}
                </AuthButton>

                <div className="auth-divider" />

                <div className="auth-switch-line">
                  Don't have an account?{" "}
                  <a href="#" onClick={(e) => { e.preventDefault(); setActiveForm("signup"); }}>
                    Sign up
                  </a>
                </div>

              </form>
            )}


           {/* Forgot Password Form */}
        {activeForm === "forgot" && (
          <form onSubmit={handleForgotPassword} className="auth-form">
            {forgotStep === "email" ? (
              <>
                <div className="form-group">
                  <label>Email Address</label>
                  <input
                    type="email"
                    placeholder="Type your email"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    disabled={isLoading}
                    required
                  />
                  <small className="form-hint">
                    We'll send a password reset OTP to this email
                  </small>
                </div>

                {/* CAPTCHA */}
                {requiresCaptcha && (
                  <div className="form-group captcha-group" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div className="captcha-robot-row">
                      <input
                        type="checkbox"
                        id="robotCheckForgot"
                        checked={robotChecked}
                        onChange={(e) => setRobotChecked(e.target.checked)}
                        style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                      />
                      <label htmlFor="robotCheckForgot" style={{ margin: 0, cursor: 'pointer', fontSize: '1rem', flex: 1 }}>
                        I'm not a robot
                      </label>
                      <img src="https://www.gstatic.com/recaptcha/api2/logo_48.png" alt="captcha icon" style={{ width: '28px', opacity: 0.7 }} />
                    </div>

                    {robotChecked && captchaImageBase64 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <img src={captchaImageBase64} alt="CAPTCHA" style={{ flex: 1, borderRadius: '4px', border: '1px solid #333', height: '70px', objectFit: 'cover', width: '100%' }} />
                          <button
                            type="button"
                            onClick={fetchCaptcha}
                            className="btn-secondary"
                            style={{ padding: 0, fontSize: '1.2rem', height: '32px', width: '32px', minWidth: '32px', minHeight: '32px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            title="Reload CAPTCHA"
                          >
                            ↻
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="Enter the letters above"
                          value={captchaText}
                          onChange={(e) => setCaptchaText(e.target.value)}
                          disabled={isLoading}
                          required={robotChecked}
                        />
                      </div>
                    )}
                  </div>
                )}

                {forgotError && <div className="error-message">{forgotError}</div>}
                {forgotSuccess && (
                  <div className="success-message">{forgotSuccess}</div>
                )}

                <AuthButton disabled={isLoading || !forgotEmail}>
                  {isLoading ? "Sending..." : "Send Reset Link"}
                </AuthButton>
              </>
            ) : (
              <>
                <div className="form-group">
                  <label>One-Time Password (OTP)</label>
                  <input
                    type="text"
                    placeholder="Enter the 6-digit OTP from your email"
                    value={resetOtp}
                    onChange={(e) => setResetOtp(e.target.value)}
                    disabled={isLoading}
                    maxLength="6"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>New Password</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Minimum 12 characters"
                      value={resetNewPassword}
                      onChange={(e) => setResetNewPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isLoading}
                    >
                      {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                    </button>
                  </div>
                  <PasswordRules password={resetNewPassword} />
                </div>

                <div className="form-group">
                  <label>Confirm Password</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm your password"
                      value={resetConfirm}
                      onChange={(e) => setResetConfirm(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      disabled={isLoading}
                    >
                      {showConfirmPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                    </button>
                  </div>
                </div>

                {forgotError && <div className="error-message">{forgotError}</div>}
                {forgotSuccess && (
                  <div className="success-message">{forgotSuccess}</div>
                )}

                <AuthButton disabled={isLoading || !resetOtp || !resetNewPassword || !resetConfirm}>
                  {isLoading ? "Resetting..." : "Reset Password"}
                </AuthButton>
              </>
            )}

            {/* Back to Sign In */}
            <div className="form-footer">
              <button
                type="button"
                onClick={() => {
                  setActiveForm("signin");
                  setForgotEmail("");
                  setResetOtp("");
                  setResetNewPassword("");
                  setResetConfirm("");
                  setForgotStep("email");
                  setForgotError("");
                  setForgotSuccess("");
                }}
                className="link-btn"
              >
                ← Back to Sign In
              </button>
            </div>
          </form>
        )}

            {/* Sign Up Form */}
        {activeForm === "signup" && (
          <form onSubmit={handleSignUp} className="auth-form">
            <div className="role-selector">
              <label className="role-label">Register as:</label>
              <div className="role-options">
                {/* Sign-up is Admin only for now; Client / Operator are disabled. */}
                <button
                  type="button"
                  className="role-option active"
                  onClick={() => setRole("admin")}
                >
                  Admin
                </button>
                <button
                  type="button"
                  className="role-option"
                  disabled
                  title="Not available for registration"
                >
                  Client
                </button>
                <button
                  type="button"
                  className="role-option"
                  disabled
                  title="Not available for registration"
                >
                  Operator
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="Type your email"
                value={signUpEmail}
                onChange={(e) => setSignUpEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            {signUpMethod === "password" && (
              <>
                <div className="form-group">
                  <div className="password-header">
                    <label>Password</label>
                    <button
                      type="button"
                      className="hint-toggle"
                      onClick={() => setShowPasswordHint((v) => !v)}
                      aria-expanded={showPasswordHint}
                      aria-controls="signup-password-hint"
                      aria-label={showPasswordHint ? "Hide password requirements" : "Show password requirements"}
                      title="Password requirements"
                    >
                      <InfoIcon />
                    </button>
                  </div>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Minimum 12 characters"
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                    <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} disabled={isLoading}>
                      <EyeIcon open={showPassword} />
                    </button>
                  </div>
                  <PasswordStrength password={signUpPassword} />
                  {showPasswordHint && (
                    <div id="signup-password-hint">
                      <PasswordRules password={signUpPassword} />
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label>Confirm Password</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm your password"
                      value={signUpConfirm}
                      onChange={(e) => setSignUpConfirm(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                    <button type="button" className="password-toggle" onClick={() => setShowConfirmPassword(!showConfirmPassword)} disabled={isLoading}>
                      <EyeIcon open={showConfirmPassword} />
                    </button>
                  </div>
                  {signUpConfirm && (
                    <small className={`pw-match ${signUpPassword === signUpConfirm ? "ok" : "bad"}`}>
                      {signUpPassword === signUpConfirm ? "✓ Passwords match" : "Passwords do not match"}
                    </small>
                  )}
                </div>
              </>
            )}

            {signUpMethod === "otp" && (
              <small className="form-hint">
                We'll email you a one-time password to verify your account and set your password.
              </small>
            )}

            {signUpError && <div className="error-message">{signUpError}</div>}
            {signUpSuccess && <div className="success-message">{signUpSuccess}</div>}

            <AuthButton disabled={isLoading ||
              !signUpEmail ||
              (signUpMethod === "password" &&
              (!isStrongPassword(signUpPassword) || signUpPassword !== signUpConfirm))}>
              {isLoading ? "Creating account..." : signUpMethod === "password" ? "Create account" : "Send OTP"}
            </AuthButton>

            <div className="auth-switch-line">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setSignUpMethod(signUpMethod === "password" ? "otp" : "password");
                  setShowPasswordHint(false);
                  setSignUpError("");
                  setSignUpSuccess("");
                }}
              >
                {signUpMethod === "password" ? "← Use email OTP instead" : "← Use a password instead"}
              </a>
            </div>

            <div className="auth-divider" />

            <div className="auth-switch-line">
              Already have an account?{" "}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setSignUpPassword("");
                  setSignUpConfirm("");
                  setActiveForm("signin");
                }}
              >
                Log in
              </a>
            </div>
          </form>
        )}

        {/* Verify OTP Form */}
        {activeForm === "verify" && (
          <form onSubmit={handleVerifyOtp} className="auth-form">
            <h3 className="verify-title">Finalize Account</h3>

            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="Type your email"
                value={signUpEmail}
                onChange={(e) => setSignUpEmail(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            <div className="form-group">
              <label style={{ display: "flex", justifyContent: "space-between" }}>
                <span>One-Time Password (OTP)</span>
                {signUpEmail && (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    className="btn-tint-sm resend-otp-btn"
                    disabled={isResending}
                  >
                    {isResending ? "Resending..." : "Resend OTP"}
                  </button>
                )}
              </label>
              <input
                type="text"
                placeholder="Enter the 6-digit OTP from your email"
                value={verifyOtp}
                onChange={(e) => setVerifyOtp(e.target.value)}
                disabled={isLoading}
                maxLength="6"
                required
              />
            </div>

            <div className="form-group">
              <div className="password-header">
                <label>New Password</label>
                <button
                  type="button"
                  className="hint-toggle"
                  onClick={() => setShowVerifyHint((v) => !v)}
                  aria-expanded={showVerifyHint}
                  aria-controls="verify-password-hint"
                  aria-label={showVerifyHint ? "Hide password requirements" : "Show password requirements"}
                  title="Password requirements"
                >
                  <InfoIcon />
                </button>
              </div>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 12 characters"
                  value={verifyPassword}
                  onChange={(e) => setVerifyPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
              <PasswordStrength password={verifyPassword} />
              {showVerifyHint && (
                <div id="verify-password-hint">
                  <PasswordRules password={verifyPassword} />
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Confirm Password</label>
              <div className="password-input-wrapper">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm your password"
                  value={verifyConfirm}
                  onChange={(e) => setVerifyConfirm(e.target.value)}
                  disabled={isLoading}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  disabled={isLoading}
                >
                  {showConfirmPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
            </div>

            {verifyError && <div className="error-message">{verifyError}</div>}
            {verifySuccess && <div className="success-message">{verifySuccess}</div>}

            <AuthButton disabled={isLoading || !signUpEmail || !verifyOtp || !verifyPassword || !verifyConfirm}>
              {isLoading ? "Verifying..." : "Verify & Finalize"}
            </AuthButton>

            <div className="login-footer-links">
              <a href="#" onClick={(e) => { e.preventDefault(); setActiveForm("signin"); }} className="login-footer-link">
                ← Back to Log in
              </a>
            </div>
          </form>
        )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
