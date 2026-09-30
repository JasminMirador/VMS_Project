"""
email_alerts.py
───────────────
Sends email notifications for infrastructure events.

Configure via environment variables:
  ALERT_EMAIL_FROM     → sender address
  ALERT_EMAIL_TO       → recipient address (comma-separated for multiple)
  SMTP_HOST            → SMTP server host       (default: smtp.gmail.com)
  SMTP_PORT            → SMTP server port       (default: 587)
  SMTP_USER            → SMTP login username
  SMTP_PASSWORD        → SMTP login password
  ALERT_EMAILS_ENABLED → set to "false" to disable all emails (default: true)
"""
import os
import smtplib
import threading
from app.core.database import mongo_client

from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────

ALERT_FROM    = os.environ.get("ALERT_EMAIL_FROM", "alerts@vms_db.local")
ALERT_TO_RAW  = os.environ.get("ALERT_EMAIL_TO", "")
ALERT_TO      = [e.strip() for e in ALERT_TO_RAW.split(",") if e.strip()]
SMTP_HOST     = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER     = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
EMAILS_ENABLED = os.environ.get("ALERT_EMAILS_ENABLED", "true").lower() != "false"


# ── Core sender ───────────────────────────────────────────────────────────


def _get_immediate_recipients(report_type: str):
    from app.core.database import db
    if db is None:
        return []
    schedules = db["report_schedules"].find({
        "schedule_type": "immediate", 
        "report_type": report_type, 
        "enabled": True,
        "is_deleted": {"$ne": True}
    })
    recipients = []
    for s in schedules:
        if isinstance(s.get("recipients"), list):
            recipients.extend(s["recipients"])
    return list(set(recipients))

import socket

def _get_vms_identity():
    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = "Unknown Host"
    
    host_ip = os.environ.get("HOST_IP")
    if not host_ip:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            host_ip = s.getsockname()[0]
            s.close()
        except Exception:
            host_ip = "127.0.0.1"
            
    return hostname, host_ip

def _send_email(subject: str, html_body: str, to_addrs: list = None):
    """
    Sends an email in a background thread so it never blocks the event loop.
    Silently logs on failure — never raises.
    """
    if not EMAILS_ENABLED:
        print(f"[EMAIL] (disabled) Would send: {subject}")
        return
    all_to = list(set((ALERT_TO or []) + (to_addrs or [])))
    if not all_to:
        print(f"[EMAIL] No recipient configured. Skipping: {subject}")
        return

    vms_name, vms_ip = _get_vms_identity()
    full_subject = f"[{vms_name} ({vms_ip})] {subject}"

    def _worker():
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = full_subject
            msg["From"]    = ALERT_FROM
            msg["To"]      = ", ".join(all_to)
            msg.attach(MIMEText(html_body, "html"))

            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
                server.ehlo()
                server.starttls()
                if SMTP_USER and SMTP_PASSWORD:
                    server.login(SMTP_USER, SMTP_PASSWORD)
                server.sendmail(ALERT_FROM, all_to, msg.as_string())
            print(f"[EMAIL] Sent: {full_subject}")
        except Exception as e:
            print(f"[EMAIL] Failed to send '{full_subject}': {e}")

    threading.Thread(target=_worker, daemon=True).start()


def _ts() -> str:
    from datetime import datetime, timedelta, timezone
    ist = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(ist).strftime("%Y-%m-%d %H:%M:%S IST")


def _base_template(color: str, icon: str, title: str, rows: list[tuple]) -> str:
    """Professional HTML email template centered with a chart."""
    vms_name, vms_ip = _get_vms_identity()
    all_rows = rows.copy()
    all_rows.append(("—", "—"))
    all_rows.append(("VMS Server Name", vms_name))
    all_rows.append(("VMS Server IP", vms_ip))

    row_html = ""
    for k, v in all_rows:
        if k == "—":
            row_html += f"<tr><td colspan='2' style='padding:0'><hr style='border:0;border-top:1px solid #e5e7eb;margin:12px 0'/></td></tr>"
        else:
            row_html += f"<tr><td style='padding:10px 16px;color:#4b5563;font-size:14px;font-weight:600;width:35%;border-bottom:1px solid #f3f4f6'>{k}</td><td style='padding:10px 16px;color:#1f2937;font-size:14px;border-bottom:1px solid #f3f4f6;word-break:break-all'>{v}</td></tr>"

    chart_html = f"""
    <div style='margin-top:24px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb'>
      <div style='font-size:12px;font-weight:600;color:#6b7280;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px'>System Activity Overview</div>
      <table style='width:100%;height:60px;border-collapse:collapse;margin-bottom:8px'>
        <tr>
          <td style='vertical-align:bottom;padding:0 4px'><div style='background:linear-gradient(to top, #3b82f6, #93c5fd);height:27px;border-radius:4px 4px 0 0'></div></td>
          <td style='vertical-align:bottom;padding:0 4px'><div style='background:linear-gradient(to top, #10b981, #6ee7b7);height:45px;border-radius:4px 4px 0 0'></div></td>
          <td style='vertical-align:bottom;padding:0 4px'><div style='background:linear-gradient(to top, {color}, {color}88);height:54px;border-radius:4px 4px 0 0'></div></td>
          <td style='vertical-align:bottom;padding:0 4px'><div style='background:linear-gradient(to top, #8b5cf6, #c4b5fd);height:36px;border-radius:4px 4px 0 0'></div></td>
          <td style='vertical-align:bottom;padding:0 4px'><div style='background:linear-gradient(to top, #f59e0b, #fcd34d);height:18px;border-radius:4px 4px 0 0'></div></td>
        </tr>
      </table>
      <table style='width:100%;font-size:10px;color:#9ca3af;text-align:center'>
        <tr>
          <td style='width:20%'>CPU</td>
          <td style='width:20%'>MEM</td>
          <td style='width:20%'>NET</td>
          <td style='width:20%'>DSK</td>
          <td style='width:20%'>I/O</td>
        </tr>
      </table>
    </div>
    """

    return f"""
    <div style='background-color:#f3f4f6;width:100%;padding:40px 0;font-family:"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'>
      <center>
      <div style='background:#ffffff;padding:32px;border-radius:12px;width:100%;max-width:600px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.1),0 8px 10px -6px rgba(0,0,0,0.1);border-top:6px solid {color};text-align:left'>
        
        <div style='text-align:center;margin-bottom:24px'>
          <div style='display:inline-block;background:{color}15;padding:16px;border-radius:50%;margin-bottom:12px'>
            <span style='font-size:32px'>{icon}</span>
          </div>
          <h2 style='margin:0;color:#111827;font-size:24px;font-weight:700;letter-spacing:-0.5px'>{title}</h2>
        </div>
        
        <table style='width:100%;border-collapse:collapse;margin-top:16px'>
          {row_html}
        </table>
        
        {chart_html}

        <div style='margin-top:32px;text-align:center'>
          <p style='color:#9ca3af;font-size:12px;margin:0'>Mirador VMS Automated Alert</p>
          <p style='color:#9ca3af;font-size:12px;margin:4px 0 0 0'>Generated at: {_ts()}</p>
        </div>
      </div>
      </center>
    </div>
    """


# ── Public alert functions ────────────────────────────────────────────────

def alert_device_offline(device_name: str, ip: str):
    """Fired when a camera or device goes offline."""
    recipients = _get_immediate_recipients("camera_down")
    _send_email(
        to_addrs=recipients,
        subject=f"🔴 Device Offline: {device_name} ({ip})",
        html_body=_base_template(
            color="#ef4444", icon="🔴",
            title=f"Device Offline: {device_name}",
            rows=[
                ("Device", device_name),
                ("IP Address", ip),
                ("Status", "<span style='color:#ef4444'>OFFLINE</span>"),
                ("Time", _ts()),
                ("Action", "Check device power and network connection."),
            ]
        )
    )


def alert_nvr_unreachable(device_name: str, ip: str):
    """Fired when the NVR management port (80) becomes unreachable."""
    _send_email(
        subject=f"🟠 NVR Unreachable: {device_name} ({ip})",
        html_body=_base_template(
            color="#f97316", icon="🟠",
            title=f"NVR Unreachable: {device_name}",
            rows=[
                ("Device", device_name),
                ("IP Address", ip),
                ("Port", "80 (NVR management)"),
                ("Status", "<span style='color:#f97316'>UNREACHABLE</span>"),
                ("Time", _ts()),
                ("Action", "Verify NVR service is running on the device."),
            ]
        )
    )


def alert_bandwidth_spike(device_name: str, total_mbps: float):
    """Fired when total network bandwidth exceeds the spike threshold."""
    _send_email(
        subject=f"⚡ Bandwidth Spike: {total_mbps:.1f} Mbps on {device_name}",
        html_body=_base_template(
            color="#f59e0b", icon="⚡",
            title=f"Bandwidth Spike Detected",
            rows=[
                ("Device", device_name),
                ("Total Bandwidth", f"<span style='color:#f59e0b'>{total_mbps:.1f} Mbps</span>"),
                ("Threshold", f"{os.environ.get('BW_SPIKE_THRESHOLD_KBPS', '50000')} kbps"),
                ("Time", _ts()),
                ("Action", "Check for unusual traffic or streaming issues."),
            ]
        )
    )


def alert_unexpected_reboot(device_name: str, ip: str):
    """Fired when a device reboots unexpectedly (boot time changes mid-session)."""
    _send_email(
        subject=f"⚠️ Unexpected Reboot: {device_name} ({ip})",
        html_body=_base_template(
            color="#a855f7", icon="⚠️",
            title=f"Unexpected Reboot: {device_name}",
            rows=[
                ("Device", device_name),
                ("IP Address", ip),
                ("Event", "<span style='color:#a855f7'>UNEXPECTED REBOOT DETECTED</span>"),
                ("Time", _ts()),
                ("Action", "Investigate power stability or software crash logs."),
            ]
        )
    )


def alert_switch_port_down(device_name: str, ip: str, port_name: str):
    """Fired when a monitored switch port transitions from UP to DOWN."""
    _send_email(
        subject=f"🔌 Switch Port Down: {port_name.upper()} on {device_name} ({ip})",
        html_body=_base_template(
            color="#ef4444", icon="🔌",
            title=f"Switch Port Down: {port_name.upper()}",
            rows=[
                ("Device", device_name),
                ("IP Address", ip),
                ("Port", port_name.upper()),
                ("Status", "<span style='color:#ef4444'>DOWN</span>"),
                ("Time", _ts()),
                ("Action", "Check the cable or device connected to this port."),
            ]
        )
    )

def alert_storage_full(device_name: str, usage_percent: float):
    """Fired when disk storage reaches or exceeds 95 percent."""
    recipients = _get_immediate_recipients("storage_full")
    _send_email(
        subject=f"⚠️ Storage Full: {device_name} is at {usage_percent:.1f}%",
        to_addrs=recipients,
        html_body=_base_template(
            color="#ef4444", icon="⚠️",
            title=f"Storage Capacity Critical: {device_name}",
            rows=[
                ("Device", device_name),
                ("Disk Usage", f"<span style='color:#ef4444'>{usage_percent:.1f}%</span>"),
                ("Threshold", "95.0%"),
                ("Time", _ts()),
                ("Action", "Free up disk space immediately or expand storage to prevent recording loss."),
            ]
        )
    )


def alert_recording_stopped(device_name: str, ip: str, stream_name: str, exit_code: int, error_snippet: str = ""):
    """Fired when a camera that was actively recording stops unexpectedly."""
    recipients = _get_immediate_recipients("recording_stopped")
    if not recipients and not ALERT_TO:
        return

    status_text = f"<span style='color:#ef4444'>RECORDING STOPPED (exit code {exit_code})</span>"
    rows = [
        ("Camera", device_name),
        ("IP Address", ip),
        ("Stream ID", stream_name),
        ("Status", status_text),
        ("Time", _ts()),
    ]
    if error_snippet:
        rows.append(("Error Detail", f"<code style='font-size:11px;color:#fca5a5'>{error_snippet[:300]}</code>"))
    rows.append(("Action", "Investigate the camera stream, network connection, or storage availability. Recording may have been interrupted by a stream loss, power failure, or disk issue."))

    display_name = f"{device_name} ({ip})" if device_name != ip else device_name

    _send_email(
        subject=f"🔴 Recording Stopped: {display_name}",
        to_addrs=recipients,
        html_body=_base_template(
            color="#ef4444", icon="🔴",
            title=f"Recording Stopped: {device_name}",
            rows=rows
        )
    )


