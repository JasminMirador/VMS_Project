import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import "./SupervisorLockWrapper.css";

const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL)
  || "http://localhost:8000";

export default function SupervisorLockWrapper({ pageName, children }) {
  const { user } = useAuth();
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return sessionStorage.getItem(`unlocked_${pageName}`) === "true";
  });
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Lock only applies to 'client' role
  const isClient = user?.role === "client";

  if (!isClient || isUnlocked) {
    return <>{children}</>;
  }

  const handleOverlayClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setShowModal(true);
  };

  const handleUnlockSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/verify-supervisor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error((typeof data.detail === "string" ? data.detail : (Array.isArray(data.detail) ? data.detail.map(d => d.msg || "Invalid input").join(", ") : ("Authentication failed"))));
      }

      // Success
      sessionStorage.setItem(`unlocked_${pageName}`, "true");
      setIsUnlocked(true);
      setShowModal(false);
    } catch (err) {
      setError(err.message || "Invalid credentials or unauthorized");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="supervisor-lock-container">
      {/* Blurred background preview */}
      <div className="supervisor-lock-preview">
        {children}
      </div>

      {/* Intercepting transparent overlay */}
      <div 
        className="supervisor-lock-overlay" 
        onClick={handleOverlayClick}
        title="Click to unlock with Supervisor credentials"
      >
        <div className="supervisor-lock-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Supervisor Access Required</span>
          <p>Click anywhere to unlock this page</p>
        </div>
      </div>

      {/* Unlock Modal */}
      {showModal && (
        <div className="supervisor-modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="supervisor-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="supervisor-modal-header">
              <h2>Authorize Access</h2>
              <p>Enter supervisor or administrator credentials to unlock {pageName}</p>
            </div>
            
            <form onSubmit={handleUnlockSubmit} className="supervisor-modal-form">
              <div className="form-group">
                <label>Supervisor Email</label>
                <input
                  type="email"
                  placeholder="supervisor@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>

              {error && <div className="supervisor-error-msg">{error}</div>}

              <div className="supervisor-modal-actions">
                <button 
                  type="button" 
                  className="btn-cancel" 
                  onClick={() => setShowModal(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-unlock"
                  disabled={loading}
                >
                  {loading ? "Verifying..." : "Unlock Page"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
