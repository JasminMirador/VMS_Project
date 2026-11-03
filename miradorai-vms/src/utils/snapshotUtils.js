import { apiUrl } from "../config/appConfig";

/**
 * Sends the base64 snapshot data to the backend to be saved at the absolute path specified in settings.
 * Also opens the folder if the user setting is enabled.
 * 
 * @param {string} base64Data - The base64 string (e.g. "data:image/jpeg;base64,...")
 * @param {string} cameraName - Name of the camera
 * @param {object} settings - The user settings containing snapFolder, snapOpen, snapMsg
 * @param {function} showToast - The toast function to display success/error
 */
export async function saveSnapshotToBackend(base64Data, cameraName, settings, showToast) {
  try {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    const headers = { 
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {})
    };

    const res = await fetch(apiUrl("/snapshot/save"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        base64_data: base64Data,
        camera_name: cameraName || "Unknown",
        target_folder: settings.snapFolder || ""
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }

    const data = await res.json();
    if (data.success) {
      if (settings.snapMsg) {
        showToast("Snapshot captured", "success", true);
      }
      
      if (settings.snapOpen) {
        await openSnapshotFolder(settings.snapFolder, showToast);
      }
    } else {
      throw new Error(data.error || "Backend failed to save snapshot");
    }
  } catch (error) {
    console.error("Snapshot save error:", error);
    showToast(`Snapshot failed: ${error.message}`, "error");
  }
}

export async function openSnapshotFolder(folderPath, showToast) {
  const now = Date.now();
  const lastOpen = parseInt(localStorage.getItem('miradorai_last_folder_open') || '0', 10);
  if (now - lastOpen < 5000) {
    return; // Prevent multiple file explorers from opening at once across all tabs
  }
  localStorage.setItem('miradorai_last_folder_open', now.toString());

  try {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    const headers = { 
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {})
    };

    const res = await fetch(apiUrl("/open-folder"), {
      method: "POST",
      headers,
      body: JSON.stringify({ folder_path: folderPath })
    });

    if (!res.ok) {
      throw new Error("Failed to open folder");
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || "Failed to open folder on server");
    }
  } catch (error) {
    console.error("Open folder error:", error);
    if (showToast) {
       showToast(`Could not open folder: ${error.message}`, "error");
    }
  }
}
