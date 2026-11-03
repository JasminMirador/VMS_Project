import { apiUrl } from "../config/appConfig";

export const logUI = async ({ action, category, details = {} }) => {
  try {
    const user = JSON.parse(localStorage.getItem("user"));

    await fetch(apiUrl("/logs/ui"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_email: user?.email || "unknown",
        user_role: user?.role || "unknown",
        action,
        category,
        details,
      }),
    });
  } catch (err) {
    console.error("Logging failed:", err);
  }
};