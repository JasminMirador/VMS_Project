import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiUrl } from "../config/appConfig";




export const logUIAction = async (user, action, category, details = {}) => {
  if (!user) return;
console.log("LOG USER:", user);
  try {
    await fetch(apiUrl("/logs/ui"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_email: user.email || "Unknown",
        user_role: user.role || "Unknown",
        action,
        category,
        details,
        session_id: user.sessionId || "Unknown",
      }),
    });
  } catch (err) {
    console.error("[Logger] Failed to log UI action:", err);
  }
};

const useActivityLogger = () => {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  const lastPathname = useRef("");

  // Global click listener for comprehensive tracking
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const handleClick = (e) => {
      const target = e.target.closest("button, a, [role='button'], input[type='submit']");
      if (target) {
        let text = target.innerText || target.getAttribute("aria-label") || target.title || target.value || target.tagName;
        // Truncate to reasonable length
        if (text && text.length > 50) text = text.substring(0, 50) + "...";
        logUIAction(user, `Clicked ${text}`, "click", { 
          path: location.pathname, 
          element: target.tagName.toLowerCase() 
        });
      }
    };
    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, [isAuthenticated, user, location.pathname]);

  return {
    logAction: (action, category, details) =>
      logUIAction(user, action, category, details),
  };
};

export default useActivityLogger;