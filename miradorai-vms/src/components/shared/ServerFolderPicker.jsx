import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import './ServerFolderPicker.css';
import { apiUrl } from "../../config/appConfig";



function ServerFolderPicker({ isOpen, onClose, onSelect, initialPath = "" }) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [items, setItems] = useState([]);
  const [parentPath, setParentPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDirectory = async (path) => {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("token") || sessionStorage.getItem("token");
      const headers = token ? { "Authorization": `Bearer ${token}` } : {};
      const res = await fetch(apiUrl(`/browse-directories?path=${encodeURIComponent(path)}`), { headers });
      if (!res.ok) throw new Error("Failed to fetch directory");
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        setCurrentPath(data.current_path || "");
        setParentPath(data.parent_path || "");
      } else {
        throw new Error(data.error || "Failed to load");
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadDirectory(initialPath);
    }
  }, [isOpen, initialPath]);

  const handleItemClick = (item) => {
    if (item.is_dir) {
      loadDirectory(item.path);
    }
  };

  const handleUp = () => {
    loadDirectory(parentPath);
  };

  if (!isOpen) return null;

  return (
    <Modal title="Select Snapshot Folder" onClose={onClose} width="500px">
      <div className="sfp-container">
        <div className="sfp-header">
          <button className="sfp-up-btn" onClick={handleUp} disabled={!currentPath || currentPath === parentPath}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 19V5M5 12l7-7 7 7"/>
            </svg>
          </button>
          <input 
            type="text" 
            className="sfp-path-input" 
            value={currentPath} 
            onChange={(e) => setCurrentPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadDirectory(currentPath)}
          />
          <button className="sfp-go-btn" onClick={() => loadDirectory(currentPath)}>Go</button>
        </div>
        
        {error && <div className="sfp-error">{error}</div>}
        
        <div className="sfp-list">
          {loading ? (
            <div className="sfp-loading">Loading...</div>
          ) : (
            items.length === 0 ? (
              <div className="sfp-empty">Empty or Access Denied</div>
            ) : (
              items.map((item, idx) => (
                <div key={idx} className="sfp-list-item" onClick={() => handleItemClick(item)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px', color: '#3b82f6' }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span>{item.name}</span>
                </div>
              ))
            )
          )}
        </div>
        
        <div className="sfp-footer">
          <button className="sfp-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="sfp-select-btn" onClick={() => onSelect(currentPath)} disabled={!currentPath}>Select Current Folder</button>
        </div>
      </div>
    </Modal>
  );
}

export default ServerFolderPicker;
