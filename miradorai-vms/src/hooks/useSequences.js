import { useState, useEffect, useCallback, useRef } from "react";
import { apiUrl } from "../config/appConfig";

function loadLocalSequences() {
  try {
    const saved = localStorage.getItem("miradorai_camera_sequences");
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function getAuthHeaders() {
  const token =
    localStorage.getItem("miradorai_token") ||
    sessionStorage.getItem("miradorai_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function useSequences() {
  const [sequences, setSequences] = useState(loadLocalSequences);
  const [loading, setLoading] = useState(false);
  const hasSyncedLocalRef = useRef(false);

  const fetchSequences = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/sequences"), {
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        const data = await res.json();
        const serverSequences = Array.isArray(data) ? data : [];

        // Check for local legacy sequences that need to be synced to DB
        const localList = loadLocalSequences();
        if (!hasSyncedLocalRef.current && localList.length > 0) {
          hasSyncedLocalRef.current = true;
          const serverIds = new Set(serverSequences.map((s) => s.id));
          const unsynced = localList.filter((s) => s.id && !serverIds.has(s.id));

          if (unsynced.length > 0) {
            try {
              await fetch(apiUrl("/sequences/bulk-sync"), {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({ sequences: unsynced }),
              });
              // Refetch to get merged state from DB
              const refetchRes = await fetch(apiUrl("/sequences"), {
                headers: getAuthHeaders(),
              });
              if (refetchRes.ok) {
                const refreshed = await refetchRes.json();
                setSequences(refreshed);
                localStorage.setItem("miradorai_camera_sequences", JSON.stringify(refreshed));
                setLoading(false);
                return;
              }
            } catch (e) {
              console.warn("Could not sync local sequences to DB:", e);
            }
          }
        }

        setSequences(serverSequences);
        localStorage.setItem("miradorai_camera_sequences", JSON.stringify(serverSequences));
      } else {
        console.warn("Failed to fetch sequences from DB, status:", res.status);
      }
    } catch (err) {
      console.warn("Sequences network error, falling back to localStorage:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSequences();
  }, [fetchSequences]);

  const createSequence = useCallback(async ({ name, dwellTime, cameraIds, id }) => {
    const payload = {
      name: name.trim(),
      dwellTime: dwellTime || 10,
      cameraIds: cameraIds || [],
      ...(id ? { id } : {}),
    };

    try {
      const res = await fetch(apiUrl("/sequences"), {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const created = await res.json();
        setSequences((prev) => {
          const next = [...prev.filter((s) => s.id !== created.id), created];
          localStorage.setItem("miradorai_camera_sequences", JSON.stringify(next));
          return next;
        });
        return created;
      }
    } catch (err) {
      console.error("Failed to create sequence on server:", err);
    }

    // Local fallback if server unreachable
    const fallbackSeq = {
      id: id || `seq-${Math.random().toString(36).substring(2, 9)}`,
      name: payload.name,
      dwellTime: payload.dwellTime,
      cameraIds: payload.cameraIds,
    };
    setSequences((prev) => {
      const next = [...prev, fallbackSeq];
      localStorage.setItem("miradorai_camera_sequences", JSON.stringify(next));
      return next;
    });
    return fallbackSeq;
  }, []);

  const updateSequence = useCallback(async (seqId, { name, dwellTime, cameraIds }) => {
    const payload = {
      name: name ? name.trim() : undefined,
      dwellTime,
      cameraIds,
    };

    try {
      const res = await fetch(apiUrl(`/sequences/${seqId}`), {
        method: "PUT",
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const updated = await res.json();
        setSequences((prev) => {
          const next = prev.map((s) => (s.id === seqId ? updated : s));
          localStorage.setItem("miradorai_camera_sequences", JSON.stringify(next));
          return next;
        });
        return updated;
      }
    } catch (err) {
      console.error("Failed to update sequence on server:", err);
    }

    // Local fallback
    setSequences((prev) => {
      const next = prev.map((s) =>
        s.id === seqId
          ? {
              ...s,
              ...(payload.name ? { name: payload.name } : {}),
              ...(payload.dwellTime !== undefined ? { dwellTime: payload.dwellTime } : {}),
              ...(payload.cameraIds ? { cameraIds: payload.cameraIds } : {}),
            }
          : s
      );
      localStorage.setItem("miradorai_camera_sequences", JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteSequence = useCallback(async (seqId) => {
    try {
      const res = await fetch(apiUrl(`/sequences/${seqId}`), {
        method: "DELETE",
        headers: getAuthHeaders(),
      });

      if (!res.ok) {
        console.warn("Server delete sequence returned status:", res.status);
      }
    } catch (err) {
      console.error("Failed to delete sequence on server:", err);
    }

    setSequences((prev) => {
      const next = prev.filter((s) => s.id !== seqId);
      localStorage.setItem("miradorai_camera_sequences", JSON.stringify(next));
      return next;
    });
  }, []);

  return {
    sequences,
    loading,
    fetchSequences,
    createSequence,
    updateSequence,
    deleteSequence,
    setSequences,
  };
}
