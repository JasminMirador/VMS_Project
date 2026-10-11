import React, { useState, useEffect } from "react";
import "./SupervisorModal.css";

const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "";

/**
 * SupervisorModal
 * Prompts for a supervisor password when a client tries to access a restricted page.
 * Mock password: "supervisor123" (local fallback — no backend needed)
 */
export default function SupervisorModal({ pageName, onSuccess, onCancel }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    setPassword("");
    setError("");
    setIsLoading(false);
  }, [pageName]);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-supervisor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error((typeof data.detail === "string" ? data.detail : (Array.isArray(data.detail) ? data.detail.map(d => d.msg || "Invalid input").join(", ") : ("Incorrect supervisor password. Please try again."))));
      }

      setIsLoading(false);
      onSuccess();
    } catch (err) {
      setError(err.message || "Incorrect supervisor password. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="sv-overlay" role="dialog" aria-modal="true" aria-labelledby="sv-title">
      {/* Backdrop */}
      <div className="sv-backdrop" onClick={onCancel} />

      <div className="sv-modal">
        {/* Lock Icon */}
        <div className="sv-icon-wrap">
          <svg className="sv-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        {/* Title */}
        <h2 id="sv-title" className="sv-title">Supervisor Access Required</h2>
        <p className="sv-subtitle">
          <span className="sv-page-name">{pageName}</span> requires supervisor authorization.
          <br />
          Please enter your supervisor credentials to continue.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="sv-form">
          <div className="sv-field">
            <label htmlFor="sv-password">Supervisor Password</label>
            <div className="sv-input-wrap">
              <input
                id="sv-password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter supervisor password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoFocus
                required
              />
              <button
                type="button"
                className="sv-eye-btn"
                onClick={() => setShowPassword((p) => !p)}
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="sv-error" role="alert">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <div className="sv-actions">
            <button type="button" className="sv-btn-cancel" onClick={onCancel} disabled={isLoading}>
              Cancel
            </button>
            <button
              type="submit"
              className="sv-btn-verify"
              disabled={isLoading || !password}
            >
              {isLoading ? (
                <>
                  <span className="sv-spinner" />
                  Verifying...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M9 12l2 2 4-4" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  Verify Access
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
