import { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL;

function loadGroups() {
  try {
    const saved = localStorage.getItem("miradorai_groups");
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export default function useGroups() {
  const [groups, setGroups] = useState(loadGroups);

  const fetchGroups = async () => {
    try {
      const token = (localStorage.getItem("miradorai_token") || sessionStorage.getItem("miradorai_token"));
      const res = await fetch(`${API_BASE}/api/groups`, {
        headers: {
          "Authorization": token ? `Bearer ${token}` : "",
          "Content-Type": "application/json"
        }
      });
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
        // Sync local storage for backward compatibility
        localStorage.setItem("miradorai_groups", JSON.stringify(data));
      }
    } catch (err) {
      console.error("Failed to fetch groups:", err);
      // Fallback to local storage if network fails
      try {
        const saved = localStorage.getItem("miradorai_groups");
        if (saved) setGroups(JSON.parse(saved));
      } catch (e) {}
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const updateGroups = (updater) => {
    setGroups((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try { localStorage.setItem("miradorai_groups", JSON.stringify(next)); } catch { }
      return next;
    });
  };

  return [groups, updateGroups, fetchGroups];
}
