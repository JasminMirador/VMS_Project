import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL;
const POLL_INTERVAL_MS = 10_000; // 10 seconds
export const CAMERAS_UPDATED_EVENT = "miradorai-cameras-updated";

function loadFromStorage() {
  try {
    const saved = localStorage.getItem("miradorai_devices");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

const CamerasContext = createContext({
  cameras: [],
  refetchCameras: () => {},
  isLoading: false,
});

export function CamerasProvider({ children }) {
  const [cameras, setCameras] = useState(loadFromStorage);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef(null);

  const fetchCameras = useCallback(async () => {
    const token = localStorage.getItem("miradorai_token");
    if (!token) return; // Do not fetch or trigger 401 when logged out

    try {
      const res = await fetch(`${API_BASE}/api/cameras`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.devices || data.cameras || []);

      setCameras(list);

      // Write to localStorage so pages that read it (ManagementPage, LiveView) stay in sync.
      localStorage.setItem("miradorai_devices", JSON.stringify(list));

      // Fire a same-tab CustomEvent — window.storage only fires cross-tab, so we need this
      // to immediately update LiveView and ManagementPage within the same browser tab.
      window.dispatchEvent(
        new CustomEvent(CAMERAS_UPDATED_EVENT, { detail: list })
      );
    } catch (err) {
      console.warn("[CamerasContext] Failed to fetch cameras:", err);
    }
  }, []);

  // Expose a one-shot refetch (called right after a camera is added)
  const refetchCameras = useCallback(async () => {
    setIsLoading(true);
    await fetchCameras();
    setIsLoading(false);
  }, [fetchCameras]);

  useEffect(() => {
    // Immediate fetch on mount
    fetchCameras();
    // Then poll every POLL_INTERVAL_MS
    intervalRef.current = setInterval(fetchCameras, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchCameras]);

  return (
    <CamerasContext.Provider value={{ cameras, refetchCameras, isLoading }}>
      {children}
    </CamerasContext.Provider>
  );
}

export function useCameras() {
  return useContext(CamerasContext);
}
