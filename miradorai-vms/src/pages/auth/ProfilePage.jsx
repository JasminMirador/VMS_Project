import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { QRCodeCanvas } from "qrcode.react";
import "./ProfilePage.css";

import { encryptPassword, getPublicKey } from "../../utils/crypto";

export default function ProfilePage() {
  const { user } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // MFA state
  const [mfaSecret, setMfaSecret] = useState(null);
  const [mfaUri, setMfaUri] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaSuccess, setMfaSuccess] = useState("");

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwdError("");
    setPwdSuccess("");

    if (newPassword !== confirmPassword) {
      setPwdError("New passwords do not match.");
      return;
    }

    setIsLoading(true);
    try {
      const pubKey = await getPublicKey(""); // Assuming API is same origin or use config
      const encryptedOld = await encryptPassword(oldPassword, pubKey);
      const encryptedNew = await encryptPassword(newPassword, pubKey);
      const encryptedConfirm = await encryptPassword(confirmPassword, pubKey);

      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user?.email,
          old_password: encryptedOld,
          new_password: encryptedNew,
          confirm_password: encryptedConfirm
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setPwdError(data.detail || data.message || "Failed to change password.");
      } else {
        setPwdSuccess("Password updated successfully.");
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (err) {
      setPwdError("Network error.");
    }
    setIsLoading(false);
  };

  const handleSetupMfa = async () => {
    setMfaError("");
    setIsLoading(true);
    try {
      const token = localStorage.getItem("miradorai_token");
      const res = await fetch("/api/auth/mfa/setup", {
        method: "POST",
        headers: { "Authorization": "Bearer " + token }
      });
      const data = await res.json();
      if (!res.ok) {
        setMfaError(data.detail || "Failed to setup MFA.");
      } else {
        setMfaSecret(data.secret);
        setMfaUri(data.uri);
      }
    } catch (err) {
      setMfaError("Network error.");
    }
    setIsLoading(false);
  };

  const handleVerifyMfa = async (e) => {
    e.preventDefault();
    setMfaError("");
    setIsLoading(true);
    try {
      const token = localStorage.getItem("miradorai_token");
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { 
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ code: mfaCode })
      });
      const data = await res.json();
      if (!res.ok) {
        setMfaError(data.detail || "Failed to verify MFA.");
      } else {
        setMfaSuccess("Two-Factor Authentication is now enabled on your account.");
        setMfaSecret(null);
        setMfaUri(null);
      }
    } catch (err) {
      setMfaError("Network error.");
    }
    setIsLoading(false);
  };

  return (
    <div className="profile-page-container">
      <h2 className="profile-page-title">
        <svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        Security Settings
      </h2>
      
      {/* Change Password Section */}
      <section className="security-section">
        <h3 className="security-section-title">
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
          Change Password
        </h3>
        <form onSubmit={handleChangePassword} className="security-form">
          <div className="input-group">
            <label>Current Password</label>
            <div className="password-input-wrapper">
              <input type={showOldPassword ? "text" : "password"} value={oldPassword} onChange={(e)=>setOldPassword(e.target.value)} required className="security-input" />
              <button type="button" className="password-toggle" onClick={() => setShowOldPassword(!showOldPassword)} disabled={isLoading}>
                {showOldPassword ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                )}
              </button>
            </div>
          </div>
          <div className="input-group">
            <label>New Password</label>
            <div className="password-input-wrapper">
              <input type={showNewPassword ? "text" : "password"} value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} required className="security-input" />
              <button type="button" className="password-toggle" onClick={() => setShowNewPassword(!showNewPassword)} disabled={isLoading}>
                {showNewPassword ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                )}
              </button>
            </div>
          </div>
          <div className="input-group">
            <label>Confirm New Password</label>
            <div className="password-input-wrapper">
              <input type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} required className="security-input" />
              <button type="button" className="password-toggle" onClick={() => setShowConfirmPassword(!showConfirmPassword)} disabled={isLoading}>
                {showConfirmPassword ? (
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                )}
              </button>
            </div>
          </div>
          
          {pwdError && (
            <div className="status-badge error">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {pwdError}
            </div>
          )}
          {pwdSuccess && (
            <div className="status-badge success">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              {pwdSuccess}
            </div>
          )}
          
          <button type="submit" disabled={isLoading} className="btn-primary" style={{ alignSelf: "flex-start" }}>
            Update Password
          </button>
        </form>
      </section>

      {/* MFA Section */}
      <section className="security-section">
        <h3 className="security-section-title">
          <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="2" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          Two-Factor Authentication (2FA)
        </h3>
        
        {user?.mfa_enabled && !mfaSuccess ? (
          <div className="status-badge success">
            <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Two-Factor Authentication is already enabled.
          </div>
        ) : !mfaSecret && !mfaSuccess && (
          <div>
            <p style={{ marginBottom: "20px", color: "var(--text-secondary)", fontSize: "15px", lineHeight: "1.5" }}>
              Protect your account with an extra layer of security. Once configured, you'll be required to enter both your password and an authentication code from your mobile phone in order to sign in.
            </p>
            <button type="button" onClick={handleSetupMfa} disabled={isLoading} className="btn-setup-mfa">
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
              Enable 2FA Now
            </button>
          </div>
        )}

        {mfaSecret && !mfaSuccess && (
          <div className="mfa-setup-container">
            <div className="step-text">
              <span className="step-number">1</span>
              Scan the QR code with your Authenticator App (e.g. Google Authenticator, Authy).
            </div>
            
            <div className="qr-code-wrapper">
              <QRCodeCanvas value={mfaUri} size={200} level="H" fgColor="#111827" />
            </div>
            
            <div style={{ marginBottom: "32px", fontSize: "14px", color: "var(--text-secondary)" }}>
              Can't scan the code? Enter this secret manually:<br/>
              <span className="secret-code" style={{ marginTop: "8px", display: "inline-block" }}>{mfaSecret}</span>
            </div>
            
            <div className="step-text">
              <span className="step-number">2</span>
              Enter the 6-digit code generated by your app to verify.
            </div>
            
            <form onSubmit={handleVerifyMfa} className="verify-form">
              <input 
                type="text" 
                value={mfaCode} 
                onChange={(e)=>setMfaCode(e.target.value.replace(/[^0-9]/g, ''))} 
                placeholder="000000" 
                maxLength="6" 
                required 
                className="mfa-code-input" 
              />
              <button type="submit" disabled={isLoading || mfaCode.length !== 6} className="btn-primary">
                Verify & Enable
              </button>
            </form>
          </div>
        )}

        {mfaError && (
          <div className="status-badge error" style={{ marginTop: "24px" }}>
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {mfaError}
          </div>
        )}
        
        {mfaSuccess && (
          <div className="status-badge success" style={{ marginTop: "24px" }}>
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            {mfaSuccess}
          </div>
        )}
      </section>
    </div>
  );
}



