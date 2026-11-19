import os
import smtplib
import csv
import io
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from email.utils import make_msgid, formatdate
from app.core.database import db as _db

def send_scheduled_report(schedule: dict):
    report_type = schedule.get("report_type")
    schedule_type = schedule.get("schedule_type")
    recipients = schedule.get("recipients", [])
    file_format = schedule.get("format", "pdf")
    
    if not recipients:
        print("[EMAIL REPORT] No recipients specified. Skipping.")
        return False
        
    print(f"[EMAIL REPORT] Generating {report_type} report ({schedule_type}) for {recipients}...")
    
    # ── Gather Report Data ──────────────────────────────────────────
    headers = []
    rows = []
    title = ""
    
    # Date range calculations
    now = datetime.utcnow()
    if schedule_type == "daily":
        start_time = now - timedelta(days=1)
    elif schedule_type == "weekly":
        start_time = now - timedelta(days=7)
    else: # monthly
        start_time = now - timedelta(days=30)
        
    if report_type == "alerts":
        title = f"Camera Up/Down History ({schedule_type.capitalize()})"
        headers = ["Timestamp", "Device IP", "Cam Name", "Event", "Message", "Acknowledged"]
        
        # Query infrastructure_alerts
        alerts_col = _db["infrastructure_alerts"]
        alerts = list(alerts_col.find({"timestamp": {"$gte": start_time}}).sort("timestamp", -1))
        
        for a in alerts:
            ts = a.get("timestamp")
            ts_str = ts.strftime("%Y-%m-%d %H:%M:%S") if isinstance(ts, datetime) else str(ts)
            rows.append([
                ts_str,
                a.get("ip", "—"),
                a.get("model", "—"),
                str(a.get("event", "—")).replace("_", " ").upper(),
                a.get("message", "—"),
                "Yes" if a.get("acknowledged") else "No"
            ])
            
    elif report_type == "live_alerts":
        title = f"Analytics Alerts Report ({schedule_type.capitalize()})"
        headers = ["Timestamp", "Camera IP", "Event Type", "Scenario", "Time"]
        
        # Query mqtt_logs
        mqtt_col = _db["mqtt_logs"]
        alerts = list(mqtt_col.find({"received_at": {"$gte": start_time.isoformat()}}).sort("received_at", -1))
        
        for a in alerts:
            # Axis/MQTT details
            msg = a.get("message", {})
            data = msg.get("data", {})
            
            t = a.get("type") or data.get("scenarioType") or "Object Detection"
            s = a.get("scenario") or data.get("scenario") or "Detect Any Object"
            time_val = data.get("triggerTime") or a.get("time") or "—"
            
            ip_addr = a.get("ip", "—").replace("_", ".")
            
            rows.append([
                a.get("received_at", "—"),
                ip_addr,
                str(t).upper(),
                s,
                time_val
            ])
            
    elif report_type == "health":
        title = f"Device Health & Uptime Status ({schedule_type.capitalize()})"
        headers = ["Device ID", "IP Address", "Manufacturer", "Model", "Type", "Status", "Latency", "Uptime", "Online Since", "Reboots"]
        
        # Query topology nodes
        nodes_col = _db["infrastructure_nodes"]
        nodes = list(nodes_col.find({}))
        
        for n in nodes:
            latency_ms = f"{n.get('latency')} ms" if n.get('latency') is not None else "—"
            ls = n.get("last_seen")
            ls_str = ls.strftime("%Y-%m-%d %H:%M:%S") if isinstance(ls, datetime) else str(ls) if ls else "—"
            
            rows.append([
                n.get("id", "—"),
                n.get("ip", "—"),
                n.get("manufacturer", "—"),
                n.get("model", "—"),
                str(n.get("type", "—")).upper(),
                str(n.get("status", "offline")).upper(),
                latency_ms,
                n.get("uptime", "—"),
                ls_str,
                str(n.get("reboot_count", 0))
            ])
            
    else:
        print(f"[EMAIL REPORT] Unknown report type: {report_type}")
        return False

    # ── Compose Beautiful HTML Body ─────────────────────────────────
    table_html = "<p>No records found for the selected timeframe.</p>"
    if rows:
        th_elements = "".join(f"<th>{h}</th>" for h in headers)
        tr_elements = ""
        for r in rows[:100]:
            td_elements = "".join(f"<td>{val}</td>" for val in r)
            tr_elements += f"<tr>{td_elements}</tr>"
        
        table_html = f"""
        <table>
            <thead>
                <tr>
                    {th_elements}
                </tr>
            </thead>
            <tbody>
                {tr_elements}
            </tbody>
        </table>
        """

    html_body = f"""
    <html>
    <head>
        <style>
            body {{
                font-family: Arial, sans-serif;
                background-color: #0f172a;
                color: #f1f5f9;
                margin: 0;
                padding: 20px;
            }}
            .container {{
                background-color: #1e293b;
                border: 1px solid #334155;
                border-radius: 8px;
                padding: 24px;
                max-width: 800px;
                margin: 0 auto;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            }}
            h2 {{
                color: #2dd4bf;
                margin-top: 0;
                border-bottom: 2px solid #334155;
                padding-bottom: 12px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }}
            .meta {{
                font-size: 13px;
                color: #94a3b8;
                margin-bottom: 20px;
            }}
            table {{
                width: 100%;
                border-collapse: collapse;
                margin-top: 16px;
                font-size: 13px;
            }}
            th {{
                background-color: #0f172a;
                color: #2dd4bf;
                text-align: left;
                padding: 10px;
                border-bottom: 2px solid #334155;
                text-transform: uppercase;
            }}
            td {{
                padding: 10px;
                border-bottom: 1px solid #334155;
            }}
            tr:hover {{
                background-color: rgba(255, 255, 255, 0.02);
            }}
            .footer {{
                margin-top: 24px;
                font-size: 11px;
                color: #64748b;
                text-align: center;
                border-top: 1px solid #334155;
                padding-top: 12px;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h2>{title}</h2>
            <div class="meta">
                Generated at: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")} UTC<br/>
                Report schedule: {schedule_type.capitalize()}<br/>
                Recipients: {', '.join(recipients)}
            </div>
            
            {table_html}
            
            {"" if len(rows) <= 100 else f"<p style='font-size: 12px; color: #94a3b8;'>* Showing first 100 records in email body. Full report attached.</p>"}
            
            <div class="footer">
                Mirador AI VMS - Automated Reporting Service
            </div>
        </div>
    </body>
    </html>
    """
    
    # ── Create Attachment ───────────────────────────────────────────
    file_fmt = str(schedule.get("format", "pdf")).lower()
    
    if file_fmt in ["xlsx", "excel"]:
        try:
            import openpyxl
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Report"
            ws.append(headers)
            for r in rows:
                ws.append([str(v) if v is not None else "" for v in r])
            xlsx_io = io.BytesIO()
            wb.save(xlsx_io)
            attachment_content = xlsx_io.getvalue()
            filename = f"{report_type}_report_{now.strftime('%Y%m%d')}.xlsx"
            part = MIMEBase("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        except Exception as ex_err:
            print(f"[EMAIL REPORT] Excel generation fallback to CSV: {ex_err}")
            file_fmt = "csv"

    if file_fmt == "pdf":
        try:
            from reportlab.lib.pagesizes import letter, landscape
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib import colors
            
            pdf_io = io.BytesIO()
            doc = SimpleDocTemplate(pdf_io, pagesize=landscape(letter), rightMargin=20, leftMargin=20, topMargin=20, bottomMargin=20)
            elements = []
            styles = getSampleStyleSheet()
            title_style = ParagraphStyle('ReportTitle', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=colors.HexColor('#0f172a'))
            elements.append(Paragraph(f"Mirador VMS - {title}", title_style))
            elements.append(Paragraph(f"Generated: {now.strftime('%Y-%m-%d %H:%M:%S')} UTC | Schedule: {schedule_type.capitalize()}", styles['Normal']))
            elements.append(Spacer(1, 12))
            
            table_data = [[Paragraph(str(h), styles['Normal']) for h in headers]]
            for r in rows[:200]:
                table_data.append([Paragraph(str(cell if cell is not None else "—"), styles['Normal']) for cell in r])
            
            t = Table(table_data, repeatRows=1)
            t.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0f172a')),
                ('TEXTCOLOR', (0,0), (-1,0), colors.HexColor('#2dd4bf')),
                ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
                ('BOTTOMPADDING', (0,0), (-1,0), 6),
                ('TOPPADDING', (0,0), (-1,0), 6),
                ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cbd5e1')),
                ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f8fafc')]),
            ]))
            elements.append(t)
            doc.build(elements)
            attachment_content = pdf_io.getvalue()
            filename = f"{report_type}_report_{now.strftime('%Y%m%d')}.pdf"
            part = MIMEBase("application", "pdf")
        except Exception as pdf_err:
            print(f"[EMAIL REPORT] PDF generation fallback to CSV: {pdf_err}")
            file_fmt = "csv"

    if file_fmt == "csv":
        csv_file = io.StringIO()
        writer = csv.writer(csv_file)
        writer.writerow(headers)
        writer.writerows(rows)
        attachment_content = csv_file.getvalue().encode("utf-8")
        filename = f"{report_type}_report_{now.strftime('%Y%m%d')}.csv"
        part = MIMEBase("text", "csv")
    
    # Construct Email
    msg = MIMEMultipart("mixed")
    msg["Subject"] = f"Mirador VMS: {title}"
    msg["From"] = os.environ.get("ALERT_EMAIL_FROM", "zjasmin.pro@gmail.com")
    msg["To"] = ", ".join(recipients)
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    
    # Attach HTML Body
    msg.attach(MIMEText(html_body, "html"))
    
    # Attach Generated File
    part.set_payload(attachment_content)
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f"attachment; filename={filename}")
    msg.attach(part)
    
    # ── SMTP Connection & Dispatch ──────────────────────────────────
    smtp_host = os.environ["SMTP_HOST"]
    smtp_port = int(os.environ["SMTP_PORT"])
    smtp_user = os.environ["SMTP_USER"]
    smtp_pass = os.environ["SMTP_PASSWORD"]
    
    # Strip spaces from password if present (Gmail app password format)
    if smtp_pass:
        smtp_pass = smtp_pass.replace(" ", "")
    
    try:
        print(f"[EMAIL REPORT] Connecting to {smtp_host}:{smtp_port}...")
        server = smtplib.SMTP(smtp_host, smtp_port, timeout=15)
        server.starttls()
        print(f"[EMAIL REPORT] Logging in as {smtp_user}...")
        server.login(smtp_user, smtp_pass)
        print(f"[EMAIL REPORT] Sending email to {recipients}...")
        server.sendmail(msg["From"], recipients, msg.as_string())
        server.quit()
        print("[EMAIL REPORT] ✅ Report sent successfully!")
        return True
    except Exception as smtp_err:
        print(f"[EMAIL REPORT] ❌ SMTP Dispatch Failed: {smtp_err}")
        return False


def send_manual_email(recipients: list, subject: str, body_text: str, attachments: list = None):
    smtp_host = os.environ["SMTP_HOST"]
    smtp_port = int(os.environ["SMTP_PORT"])
    smtp_user = os.environ.get("AUTH_SMTP_USER") or os.environ["SMTP_USER"]
    smtp_pass = os.environ.get("AUTH_SMTP_PASSWORD") or os.environ["SMTP_PASSWORD"]
    sender_email = os.environ.get("AUTH_SMTP_USER") or os.environ["ALERT_EMAIL_FROM"]
    
    if not recipients:
        return False, "No recipients specified"
        
    msg = MIMEMultipart()
    msg["From"] = sender_email
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    
    msg.attach(MIMEText(body_text, "html"))
    
    if attachments:
        for attachment in attachments:
            filename = attachment.get("filename")
            file_data = attachment.get("data")
            
            part = MIMEBase("application", "octet-stream")
            part.set_payload(file_data)
            encoders.encode_base64(part)
            cid = attachment.get("cid")
            if cid:
                part.add_header('Content-ID', f'<{cid}>')
                part.add_header('Content-Disposition', 'inline', filename=filename)
            else:
                part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
            msg.attach(part)
            
    try:
        if smtp_pass:
            smtp_pass = smtp_pass.replace(" ", "")
            
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            if smtp_user and smtp_pass:
                server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        return True, "Email sent successfully"
    except Exception as e:
        print(f"Error sending manual email: {e}")
        return False, str(e)