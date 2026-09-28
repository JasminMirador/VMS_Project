import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import "./LoginPage.css";
import useActivityLogger from "../../hooks/useActivityLogger";
import SpecularButton from "../../components/shared/SpecularButton";

const PasswordRules = ({ password }) => {
  const rules = [
    { label: "At least 12 characters long", test: p => p.length >= 12 },
    { label: "One uppercase letter", test: p => /[A-Z]/.test(p) },
    { label: "One lowercase letter", test: p => /[a-z]/.test(p) },
    { label: "One number", test: p => /[0-9]/.test(p) },
    { label: "One special character", test: p => /[!@#\$%^&*(),.?":{}|<>]/ .test(p) }
  ];

  return (
    <div className="password-rules">
      {rules.map((rule, idx) => {
        const passed = rule.test(password || "");
        return (
          <div key={idx} className={`password-rule ${passed ? 'passed' : ''}`}>
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

const LoginPage = () => {
  const { login, completeLogin, signup, finalizeSignup, forgotPassword, resetPassword } = useAuth();
  const { theme } = useTheme();
  const [activeForm, setActiveForm] = useState("signin"); // "signin" | "forgot" | "signup" | "verify"
  const [role, setRole] = useState("admin");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { logAction } = useActivityLogger();

  useEffect(() => {
    // Log pre-authentication site visit
    fetch('/api/auth/visit', { method: 'POST' }).catch(() => {});
  }, []);

  // Sign In Form
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInError, setSignInError] = useState("");
  const [activeSessionWarning, setActiveSessionWarning] = useState(null);

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
    const result = await login(signInEmail, signInPassword, role, captchaId, captchaText, mfaCode);

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
      setActiveSessionWarning({ user: result.user, token: result.token });
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
        setSignInError(data.detail || data.message || "Failed to change password");
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

    const result = await signup(signUpEmail, role);
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
        setVerifyError(data.detail || "Failed to resend OTP");
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
      const result = await forgotPassword(forgotEmail);
      if (!result.success) {
        setForgotError(result.error);
        setIsLoading(false);
        return;
      }

      setForgotSuccess(result.message);
      setForgotStep("reset");
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

  return (
    <div className={`login-page ${theme === "light" ? "light" : "dark"}`} data-theme={theme}>
      <div className="login-container">
        {/* Logo/Title */}
        <div className="login-header">
          <h1 className="login-title">
            {activeForm === "signin" && "Log in"}
            {activeForm === "forgot" && "Reset Password"}
            {activeForm === "signup" && "Create Account"}
          </h1>
          <p className="login-subtitle">MIRADOR VMS</p>
        </div>

        {/* Sign In Form */}
        {activeForm === "signin" && showChangePassword && (
          <form onSubmit={handleForcedPasswordChange} className="auth-form">
            <p className="theme-description">Your account requires a password change.</p>
            <div className="form-group">
              <label>New Password</label>
              <div className="password-input-wrapper">
                <input type={showPassword ? "text" : "password"} placeholder="Enter new password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={isLoading} required />
                <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
              <PasswordRules password={newPassword} />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <div className="password-input-wrapper">
                <input type={showConfirmPassword ? "text" : "password"} placeholder="Confirm password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} disabled={isLoading} required />
                <button type="button" className="password-toggle" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                  {showConfirmPassword ? (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  )}
                </button>
              </div>
            </div>
            {signInError && <div className="error-message">{signInError}</div>}
            {activeSessionWarning && (
              <div className="warning-message" style={{ marginTop: '16px', marginBottom: '16px' }}>
                <p>This user already has an active session on another device.</p>
                <div className="warning-message-actions">
                  <button 
                    type="button"
                    onClick={() => setActiveSessionWarning(null)}
                    className="session-cancel-btn"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      completeLogin(activeSessionWarning.user, activeSessionWarning.token, activeSessionWarning.session_id);
                      logAction("User logged in (concurrent)", "auth", { email: signInEmail });
                    }}
                    className="session-continue-btn"
                  >
                    Continue Anyway
                  </button>
                </div>
              </div>
            )}

            
            <SpecularButton type="submit" size="md" radius={8} tint="#10b981" tintOpacity={0.1} blur={4} textColor={theme === "light" ? "#065f46" : "#f0fff8"} lineColor="#10b981" baseColor={theme === "light" ? "#ecfdf5" : "#0d3326"} intensity={1.2} shineSize={12} shineFade={38} thickness={1} followMouse proximity={220} disabled={isLoading || !newPassword || !confirmNewPassword} className="login-specular-btn">
              {isLoading ? "Updating..." : "Change Password"}
            </SpecularButton>
            <button type="button" onClick={() => setShowChangePassword(false)} className="link-btn" style={{ marginTop: '16px', display: 'block', width: '100%' }}>Cancel</button>
          </form>
        )}

        {activeForm === "signin" && showMfaInput && (
          <form onSubmit={handleSignIn} className="auth-form">
            <p className="theme-description">Two-Factor Authentication is enabled on this account.</p>
            <div className="form-group">
              <label>Authenticator Code</label>
              <input type="text" placeholder="6-digit code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} disabled={isLoading} required maxLength="6" />
            </div>
            {signInError && <div className="error-message">{signInError}</div>}
            {activeSessionWarning && (
              <div className="warning-message" style={{ marginTop: '16px', marginBottom: '16px' }}>
                <p>This user already has an active session on another device.</p>
                <div className="warning-message-actions">
                  <button 
                    type="button"
                    onClick={() => setActiveSessionWarning(null)}
                    className="session-cancel-btn"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      completeLogin(activeSessionWarning.user, activeSessionWarning.token, activeSessionWarning.session_id);
                      logAction("User logged in (concurrent)", "auth", { email: signInEmail });
                    }}
                    className="session-continue-btn"
                  >
                    Continue Anyway
                  </button>
                </div>
              </div>
            )}

            
            <SpecularButton type="submit" size="md" radius={8} tint="#10b981" tintOpacity={0.1} blur={4} textColor={theme === "light" ? "#065f46" : "#f0fff8"} lineColor="#10b981" baseColor={theme === "light" ? "#ecfdf5" : "#0d3326"} intensity={1.2} shineSize={12} shineFade={38} thickness={1} followMouse proximity={220} disabled={isLoading || !mfaCode || mfaCode.length < 6} className="login-specular-btn">
              {isLoading ? "Verifying..." : "Verify"}
            </SpecularButton>
            <button type="button" onClick={() => setShowMfaInput(false)} className="link-btn" style={{ marginTop: '16px', display: 'block', width: '100%' }}>Cancel</button>
          </form>
        )}

        {activeForm === "signin" && !showChangePassword && !showMfaInput && (
          <form onSubmit={handleSignIn} className="auth-form">
            {/* Role Selection */}
            <div className="role-selector">
              <label className="role-label">Login as:</label>
              <div className="role-options">
                <button
                  type="button"
                  className={`role-option ${role === "admin" ? "active" : ""}`}
                  onClick={() => setRole("admin")}
                >
                  Admin
                </button>
                <button
                  type="button"
                  className={`role-option ${role === "client" ? "active" : ""}`}
                  onClick={() => setRole("client")}
                >
                  Client
                </button>
                <button
                  type="button"
                  className={`role-option ${role === "operator" ? "active" : ""}`}
                  onClick={() => setRole("operator")}
                >
                  Operator
                </button>
              </div>
            </div>

            {/* Email Input */}
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                placeholder="Type your email"
                value={signInEmail}
                onChange={(e) => setSignInEmail(e.target.value)}
                disabled={isLoading}
                required
              />
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
                  }}
                  className="forgot-link"
                >
                  Forgot password?
                </a>
              </div>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Type your password"
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
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

            {/* CAPTCHA */}
            {requiresCaptcha && (
              <div className="form-group captcha-group" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', border: '1px solid #333', borderRadius: '4px', backgroundColor: 'rgba(0,0,0,0.2)' }}>
                  <input 
                    type="checkbox" 
                    id="robotCheck"
                    checked={robotChecked}
                    onChange={(e) => setRobotChecked(e.target.checked)}
                    style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                  />
                  <label htmlFor="robotCheck" style={{ margin: 0, cursor: 'pointer', fontSize: '1rem', flex: 1 }}>
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

            {/* Error */}
            {signInError && <div className="error-message">{signInError}</div>}
            {activeSessionWarning && (
              <div className="warning-message" style={{ marginTop: '16px', marginBottom: '16px' }}>
                <p>This user already has an active session on another device.</p>
                <div className="warning-message-actions">
                  <button 
                    type="button"
                    onClick={() => setActiveSessionWarning(null)}
                    className="session-cancel-btn"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      completeLogin(activeSessionWarning.user, activeSessionWarning.token, activeSessionWarning.session_id);
                      logAction("User logged in (concurrent)", "auth", { email: signInEmail });
                    }}
                    className="session-continue-btn"
                  >
                    Continue Anyway
                  </button>
                </div>
              </div>
            )}

            

            {/* Warning */}
            

            {/* Sign In Button */}
            <SpecularButton
              type="submit"
              size="md"
              radius={8}
              tint="#10b981"
              tintOpacity={0.10}
              blur={4}
              textColor={theme === "light" ? "#065f46" : "#f0fff8"}
              lineColor="#10b981"
              baseColor={theme === "light" ? "#ecfdf5" : "#0d3326"}
              intensity={1.2}
              shineSize={12}
              shineFade={38}
              thickness={1}
              followMouse
              proximity={220}
              disabled={isLoading || !signInEmail || !signInPassword}
              className="login-specular-btn"
            >
              {isLoading ? "Signing in..." : "Log in"}
            </SpecularButton>

            {role === "admin" && (
              <div className="login-footer-links">
                Don't have an account?{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); setActiveForm("signup"); }} className="login-footer-link">
                  Sign up
                </a>
                <br/><br/>
                Have an OTP?{" "}
                <a href="#" onClick={(e) => { e.preventDefault(); setActiveForm("verify"); }} className="login-footer-link">
                  Finalize Account
                </a>
              </div>
            )}



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

                {forgotError && <div className="error-message">{forgotError}</div>}
                {forgotSuccess && (
                  <div className="success-message">{forgotSuccess}</div>
                )}

                <SpecularButton
                  type="submit"
                  size="md"
                  radius={8}
                  tint="#10b981"
                  tintOpacity={0.10}
                  blur={4}
                  textColor={theme === "light" ? "#065f46" : "#f0fff8"}
                  lineColor="#10b981"
                  baseColor={theme === "light" ? "#ecfdf5" : "#0d3326"}
                  intensity={1.2}
                  shineSize={12}
                  shineFade={38}
                  thickness={1}
                  followMouse
                  proximity={220}
                  disabled={isLoading || !forgotEmail}
                  className="login-specular-btn"
                >
                  {isLoading ? "Sending..." : "Send Reset Link"}
                </SpecularButton>
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

                <SpecularButton
                  type="submit"
                  size="md"
                  radius={8}
                  tint="#10b981"
                  tintOpacity={0.10}
                  blur={4}
                  textColor={theme === "light" ? "#065f46" : "#f0fff8"}
                  lineColor="#10b981"
                  baseColor={theme === "light" ? "#ecfdf5" : "#0d3326"}
                  intensity={1.2}
                  shineSize={12}
                  shineFade={38}
                  thickness={1}
                  followMouse
                  proximity={220}
                  disabled={isLoading || !resetOtp || !resetNewPassword || !resetConfirm}
                  className="login-specular-btn"
                >
                  {isLoading ? "Resetting..." : "Reset Password"}
                </SpecularButton>
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
                <button
                  type="button"
                  className={`role-option ${role === "admin" ? "active" : ""}`}
                  onClick={() => setRole("admin")}
                >
                  Admin
                </button>
                <button
                  type="button"
                  className={`role-option ${role === "client" ? "active" : ""}`}
                  onClick={() => setRole("client")}
                >
                  Client
                </button>
                <button
                  type="button"
                  className={`role-option ${role === "operator" ? "active" : ""}`}
                  onClick={() => setRole("operator")}
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



            {signUpError && <div className="error-message">{signUpError}</div>}
            {signUpSuccess && <div className="success-message">{signUpSuccess}</div>}

            <SpecularButton
              type="submit"
              size="md"
              radius={8}
              tint="#10b981"
              tintOpacity={0.10}
              blur={4}
              textColor={theme === "light" ? "#065f46" : "#f0fff8"}
              lineColor="#10b981"
              baseColor={theme === "light" ? "#ecfdf5" : "#0d3326"}
              intensity={1.2}
              shineSize={12}
              shineFade={38}
              thickness={1}
              followMouse
              proximity={220}
              disabled={isLoading || !signUpEmail}
              className="login-specular-btn"
            >
              {isLoading ? "Creating account..." : "Sign up"}
            </SpecularButton>

            <div className="login-footer-links">
              Already have an account?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setActiveForm("signin"); }} className="login-footer-link">
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
                    className="resend-otp-btn"
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
              <label>New Password</label>
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
              <PasswordRules password={verifyPassword} />
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

            <SpecularButton
              type="submit"
              size="md"
              radius={8}
              tint="#10b981"
              tintOpacity={0.10}
              blur={4}
              textColor={theme === "light" ? "#065f46" : "#f0fff8"}
              lineColor="#10b981"
              baseColor={theme === "light" ? "#ecfdf5" : "#0d3326"}
              intensity={1.2}
              shineSize={12}
              shineFade={38}
              thickness={1}
              followMouse
              proximity={220}
              disabled={isLoading || !signUpEmail || !verifyOtp || !verifyPassword || !verifyConfirm}
              className="login-specular-btn"
            >
              {isLoading ? "Verifying..." : "Verify & Finalize"}
            </SpecularButton>

            <div className="login-footer-links">
              <a href="#" onClick={(e) => { e.preventDefault(); setActiveForm("signin"); }} className="login-footer-link">
                ← Back to Log in
              </a>
            </div>
          </form>
        )}
      </div>

      {/* Background */}
      <div className="login-background">
        <div className="bg-circle bg-circle-1"></div>
        <div className="bg-circle bg-circle-2"></div>
        <div className="bg-circle bg-circle-3"></div>
      </div>
    </div>
  );
};

export default LoginPage;






