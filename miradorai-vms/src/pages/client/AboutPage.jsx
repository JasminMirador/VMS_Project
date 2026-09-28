import "./AboutPage.css";
import logoImg from "../../assets/logo.jpg";
 
const platformDetails = [
  ["version", "Version", "1.4.0"],
  ["build-date", "Build Date", "2025-03-09"],
  ["server", "Server", "MIRADOR-VMS"],
  ["license", "License", "Enterprise"],
  ["cameras", "Connected Cameras", "4"],
  ["recordings", "Active Recordings", "0"],
];
 
export default function AboutPage() {
  return (
    <div className="page-shell about-page">
      <div className="about-main-card">
        <div className="about-main-content">
          <div className="about-logo-mark">
            <img src={logoImg} alt="MIRADOR AI" className="about-logo-img" />
          </div>
          <div className="about-product-content">
            <div className="about-product-name">MIRADOR VMS</div>
            <div className="about-tagline">Video Management Platform</div>
            <div className="about-version-badge">v1.4.0</div>
          </div>
        </div>
      </div>
 
      <div className="about-card about-platform-card">
        <div className="about-section-title">Platform Details</div>
        <div className="about-platform-details">
          {platformDetails.map(([id, label, value]) => (
            <button
              type="button"
              key={id}
              className="about-detail-item"
            >
              <span>{label}</span>
              <strong>{value}</strong>
            </button>
          ))}
        </div>
      </div>
 
      <div className="about-legal-card">
        <div className="about-legal-text">
          <div className="about-legal-box">
            MIRADOR VMS is an independent video management platform. All third-party trademarks remain property of their respective owners.
          </div>
          <div className="about-legal-box">
            © 2025 MIRADOR Technologies. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}