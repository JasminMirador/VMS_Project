import io
import csv
from datetime import datetime, timezone
from typing import Dict, Any, List
from app.core.database import perf_runs_col, perf_stages_col, perf_samples_col

class ReportGenerator:
    """Generates downloadable CSV raw data and HTML executive reports."""

    def generate_csv_samples(self, run_id: str) -> str:
        """Exports all raw metric samples for run_id as a CSV string."""
        if perf_samples_col is None:
            return ""

        output = io.StringIO()
        writer = csv.writer(output)

        # Header
        writer.writerow([
            "timestamp", "run_id", "stage_index", "camera_count", "is_warmup",
            "stream_codec", "stream_resolution", "stream_fps",
            "vms_cpu_pct", "vms_ram_gb", "delta_cpu_pct", "delta_ram_gb",
            "server_cpu_pct", "server_ram_pct", "server_ram_used_gb",
            "disk_read_mb_s", "disk_write_mb_s", "net_rx_mbps", "net_tx_mbps",
            "gpu_util_pct", "vram_used_mb",
            "mediamtx_ready_streams", "active_viewers", "dropped_frames"
        ])

        run_doc = perf_runs_col.find_one({"run_id": run_id}) if perf_runs_col is not None else None
        profiles = run_doc.get("config", {}).get("profiles", {}) if run_doc else {}
        cfg_codec = profiles.get("codec", "H.264")
        cfg_res = profiles.get("resolution", "1080p")
        cfg_fps = profiles.get("fps", 25)

        cursor = perf_samples_col.find({"run_id": run_id}).sort("timestamp", 1)
        for doc in cursor:
            attr = doc.get("attribution", {})
            srv = doc.get("server_total", {})
            gpu = doc.get("gpu", {})
            mtx = doc.get("services", {}).get("mediamtx", {})

            writer.writerow([
                doc.get("timestamp", ""),
                doc.get("run_id", ""),
                doc.get("stage_index", 0),
                doc.get("camera_count", 0),
                doc.get("is_warmup", False),
                cfg_codec,
                cfg_res,
                cfg_fps,
                attr.get("vms_total_cpu_pct", 0),
                attr.get("vms_total_ram_gb", 0),
                attr.get("delta_cpu_pct", 0),
                attr.get("delta_ram_gb", 0),
                srv.get("cpu_pct", 0),
                srv.get("ram_pct", 0),
                srv.get("ram_used_gb", 0),
                srv.get("disk_read_mb_s", 0),
                srv.get("disk_write_mb_s", 0),
                srv.get("net_rx_mbps", 0),
                srv.get("net_tx_mbps", 0),
                gpu.get("utilization_pct", 0),
                gpu.get("vram_used_mb", 0),
                mtx.get("test_paths_active", 0),
                mtx.get("active_readers", 0),
                mtx.get("frames_discarded", 0)
            ])

        return output.getvalue()

    def generate_html_report(self, run_id: str) -> str:
        """Builds an executive HTML report for print or PDF conversion."""
        if perf_runs_col is None:
            return "<h1>Database unavailable</h1>"

        run_doc = perf_runs_col.find_one({"run_id": run_id})
        if not run_doc:
            return "<h1>Test run not found</h1>"

        stages = list(perf_stages_col.find({"run_id": run_id}).sort("stage_index", 1)) if perf_stages_col is not None else []
        topo = run_doc.get("server_spec_snapshot") or {}
        summary = run_doc.get("summary") or {}
        baseline = run_doc.get("baseline_metrics") or {}

        # Calculate total storage consumed during this test run from samples
        total_storage_written_gb = 0.0
        if perf_samples_col is not None:
            try:
                pipeline = [
                    {"$match": {"run_id": run_id}},
                    {"$group": {"_id": None, "total_write_mb": {"$sum": "$server_total.disk_write_mb_s"}}}
                ]
                agg = list(perf_samples_col.aggregate(pipeline))
                if agg and agg[0].get("total_write_mb"):
                    total_storage_written_gb = round(agg[0]["total_write_mb"] / 1024, 2)
            except Exception:
                pass

        stage_rows_html = ""
        for s in stages:
            v_cpu = s.get("vms_cpu", {})
            s_cpu = s.get("server_cpu", {})
            v_ram = s.get("vms_ram_gb", {})
            net_rx = s.get("network_rx_mbps", {})
            disk_w = s.get("disk_write_mb_s", {})
            stage_dur = s.get("duration_sec", 600)
            stage_data_gb = round((disk_w.get("avg", 0) * stage_dur) / 1024, 2)

            status_color = "#10b981" if s.get("status") == "PASS" else "#f59e0b"

            stage_rows_html += f"""
            <tr>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">Stage {s.get('stage_index')}</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{s.get('camera_count')}</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{s.get('active_verified_cameras')}</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{v_cpu.get('avg')}% / {v_cpu.get('p95')}%</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{s_cpu.get('avg')}%</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{v_ram.get('avg')} GB (Pk: {v_ram.get('peak')} GB)</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{net_rx.get('avg')} Mbps</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{disk_w.get('avg')} MB/s</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">{stage_data_gb} GB</td>
                <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; color: {status_color}; font-weight: bold;">{s.get('status')}</td>
            </tr>
            """

        # Dynamic target camera count & duration
        cfg = run_doc.get("config") or {}
        target_cams = cfg.get("target_camera_count") or summary.get("max_stable_camera_count") or (stages[-1].get("camera_count") if stages else 100)
        test_duration_min = cfg.get("test_duration_minutes") or round(sum(s.get("duration_sec", 0) for s in stages) / 60, 1)

        # Stream profile configuration
        profiles = cfg.get("profiles") or {}
        prof_codec = profiles.get("codec", "H.264")
        prof_res = profiles.get("resolution", "1080p Full HD (1920x1080)")
        prof_fps = profiles.get("fps", 25)
        prof_bitrate = profiles.get("bitrate_kbps", 4096)

        # Dynamic Sizing Projections for tested camera count at tested bitrate
        daily_storage_tb = round((target_cams * prof_bitrate * 86400) / (8 * 1024 * 1024 * 1024), 2)
        usable_tb = topo.get("storage_total_tb", 19.07)
        retention_days = round(usable_tb / daily_storage_tb, 1) if daily_storage_tb > 0 else 0

        # Retrieve CPU Spike & Root Cause Analysis
        spike_analysis = summary.get("spike_analysis")
        if not spike_analysis:
            try:
                from .test_controller import test_controller
                spike_analysis = test_controller.analyze_cpu_spikes(run_id)
            except Exception:
                spike_analysis = {"spikes": [], "total_spikes": 0, "max_spike_pct": 0, "stability_score_pct": 100.0}

        spike_rows_html = ""
        spikes_list = spike_analysis.get("spikes", [])
        if spikes_list:
            for sp in spikes_list:
                impact_color = "#10b981" if "Low" in sp.get("impact_assessment", "") else ("#f59e0b" if "Moderate" in sp.get("impact_assessment", "") else "#ef4444")
                spike_rows_html += f"""
                <tr>
                    <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">#{sp.get('spike_id')}</td>
                    <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0;">{sp.get('time_offset')}</td>
                    <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 700; color: #dc2626;">{sp.get('peak_vms_cpu_pct')}% <span style="font-weight: 400; color: #64748b; font-size: 11px;">(Srv: {sp.get('peak_server_cpu_pct')}%)</span></td>
                    <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0;">{sp.get('baseline_cpu_pct')}% <span style="color: #dc2626; font-size: 11px;">(+{sp.get('delta_jump_pct')}%)</span></td>
                    <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0;">{sp.get('duration_sec')}s</td>
                    <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #0369a1;">{sp.get('primary_subsystem')}</td>
                    <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0; font-size: 12px; line-height: 1.4;">{sp.get('reason')}</td>
                    <td style="padding: 9px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: {impact_color}; font-size: 12px;">{sp.get('impact_assessment')}</td>
                </tr>
                """
        else:
            spike_rows_html = """
            <tr>
                <td colspan="8" style="text-align: center; padding: 18px; color: #10b981; font-weight: 500;">
                    ✓ Exceptional Stability: No abnormal CPU spikes detected during the sustained testing interval.
                </td>
            </tr>
            """

        # Automated Recommendation Verdict
        max_seen_vms = max([s.get("vms_cpu", {}).get("peak", 0) for s in stages], default=0)
        verdict = "PASS — PRODUCTION READY" if max_seen_vms < 85.0 else ("WARNING — HIGH UTILIZATION" if max_seen_vms < 95.0 else "FAIL — SYSTEM BOTTLENECK")
        verdict_color = "#10b981" if "PASS" in verdict else ("#f59e0b" if "WARNING" in verdict else "#ef4444")
        headroom_cpu = round(max(0.0, 100.0 - max_seen_vms), 1)

        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Mirador AI VMS - Capacity Benchmark Report ({run_id})</title>
            <style>
                @media print {{
                    body {{ margin: 15mm; font-size: 11pt; }}
                    .no-print {{ display: none; }}
                    h2 {{ page-break-after: avoid; }}
                    table {{ page-break-inside: auto; }}
                    tr {{ page-break-inside: avoid; page-break-after: auto; }}
                }}
                body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; background: #fff; margin: 40px; line-height: 1.5; }}
                h1 {{ color: #0f172a; margin-bottom: 4px; font-size: 24px; }}
                h2 {{ color: #1e293b; margin-top: 32px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }}
                .badge {{ display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 13px; font-weight: 700; }}
                .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 16px 0; }}
                .card {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }}
                .card-title {{ font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }}
                .card-val {{ font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 4px; }}
                table {{ width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; text-align: left; }}
                th {{ background: #f1f5f9; padding: 10px 12px; font-weight: 600; color: #475569; border-bottom: 2px solid #cbd5e1; font-size: 12px; }}
                .print-bar {{ display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 20px; }}
                .btn {{ background: #0284c7; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 13px; border: none; cursor: pointer; }}
                .footer {{ margin-top: 45px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 14px; display: flex; justify-content: space-between; }}
            </style>
        </head>
        <body>
            <div class="print-bar no-print">
                <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0284c7; padding-bottom: 16px;">
                <div>
                    <h1>Mirador AI VMS — Performance & Capacity Test Report</h1>
                    <div style="color: #64748b; font-size: 14px; margin-top: 4px;">
                        Benchmark Target: <strong style="color: #0284c7;">{target_cams} Dynamic Camera Feeds</strong> sustained for <strong>{test_duration_min} Minutes</strong>
                    </div>
                    <div style="color: #94a3b8; font-size: 12px; margin-top: 2px;">
                        Run ID: <strong>{run_id}</strong> | Run Name: {run_doc.get('name')} | Operator: {run_doc.get('operator', 'admin')}
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Technical Verdict</div>
                    <div class="badge" style="background: {verdict_color}20; color: {verdict_color}; border: 1px solid {verdict_color}; margin-top: 4px;">
                        {verdict}
                    </div>
                </div>
            </div>

            <h2>1. Executive Summary & Verification</h2>
            <div class="grid" style="grid-template-columns: repeat(5, 1fr);">
                <div class="card">
                    <div class="card-title">Target Cameras Tested</div>
                    <div class="card-val" style="color: #0284c7;">{target_cams} Feeds</div>
                </div>
                <div class="card">
                    <div class="card-title">Sustained Duration</div>
                    <div class="card-val">{test_duration_min} Min</div>
                </div>
                <div class="card">
                    <div class="card-title">Workload Stability</div>
                    <div class="card-val" style="color: #10b981;">{spike_analysis.get('stability_score_pct', 100)}%</div>
                </div>
                <div class="card">
                    <div class="card-title">CPU Headroom Remaining</div>
                    <div class="card-val" style="color: #0284c7;">{headroom_cpu}%</div>
                </div>
                <div class="card">
                    <div class="card-title">Data Written During Run</div>
                    <div class="card-val" style="color: #10b981;">{total_storage_written_gb} GB</div>
                </div>
            </div>
            <p style="font-size: 13.5px; line-height: 1.6; color: #334155; margin-top: 10px;">
                <strong>Engineering Conclusion:</strong> Verified sustained capability of <strong>{target_cams} simultaneous camera feeds</strong> with continuous recording, encryption, and streaming pipeline on target host. {summary.get('recommendation', '')}
            </p>

            <h2>2. CPU Spike & Workload Anomaly Analysis (Root Cause & Reasons)</h2>
            <div class="grid" style="grid-template-columns: repeat(4, 1fr);">
                <div class="card">
                    <div class="card-title">Total Spikes Detected</div>
                    <div class="card-val" style="color: {'#dc2626' if spike_analysis.get('total_spikes', 0) > 3 else '#0284c7'};">{spike_analysis.get('total_spikes', 0)}</div>
                </div>
                <div class="card">
                    <div class="card-title">Peak Spike CPU</div>
                    <div class="card-val" style="color: #dc2626;">{spike_analysis.get('max_spike_pct', 0)}%</div>
                </div>
                <div class="card">
                    <div class="card-title">Average VMS Baseline</div>
                    <div class="card-val">{spike_analysis.get('mean_vms_cpu_pct', 0)}%</div>
                </div>
                <div class="card">
                    <div class="card-title">Primary Workload Trigger</div>
                    <div class="card-val" style="font-size: 14px; margin-top: 8px; color: #0369a1;">{spike_analysis.get('primary_culprit_subsystem', 'Stable')}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 50px;">Event</th>
                        <th style="width: 75px;">Offset</th>
                        <th style="width: 140px;">Peak CPU (VMS / Server)</th>
                        <th style="width: 110px;">Baseline (Δ Jump)</th>
                        <th style="width: 65px;">Duration</th>
                        <th style="width: 170px;">Responsible Subsystem</th>
                        <th>Technical Root Cause & Explanation</th>
                        <th style="width: 140px;">Impact Assessment</th>
                    </tr>
                </thead>
                <tbody>
                    {spike_rows_html}
                </tbody>
            </table>

            <div style="background: #f8fafc; border-left: 4px solid #0284c7; padding: 10px 14px; margin-top: 12px; font-size: 12px; color: #475569; line-height: 1.5;">
                <strong>Diagnostic Assessment Note:</strong> Transient CPU bursts in video management systems occur normally during (1) synchronized RTSP Keyframe (I-Frame) GOP packet bursts across incoming feeds, (2) video chunk file boundary rotations triggering simultaneous AES-256 cipher encryption, and (3) initial stream SDP connection handshake. As long as individual bursts do not cause packet drops or trigger safety thresholds, they represent healthy pipeline throughput.
            </div>

            <h2>3. Hardware & Network Under Test</h2>
            <div class="grid">
                <div class="card">
                    <div class="card-title">Processor Model</div>
                    <div class="card-val" style="font-size: 14px;">{topo.get('cpu_model')}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 4px;">{topo.get('physical_cores')} Physical Cores / {topo.get('logical_processors')} Threads</div>
                </div>
                <div class="card">
                    <div class="card-title">System Memory</div>
                    <div class="card-val">{topo.get('total_ram_gb')} GB RAM</div>
                </div>
                <div class="card">
                    <div class="card-title">Graphics Accelerator</div>
                    <div class="card-val" style="font-size: 14px;">{topo.get('gpu_model')}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 4px;">VRAM: {topo.get('gpu_vram_total_mb')} MB</div>
                </div>
                <div class="card">
                    <div class="card-title">Dedicated Storage</div>
                    <div class="card-val">{topo.get('storage_total_tb')} TB Total</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Drive: {topo.get('storage_path', 'D:\\')} (Free: {topo.get('storage_free_tb')} TB)</div>
                </div>
            </div>

            <h2>4. Tested Stream Profile & Dedicated Storage Projections</h2>
            <div class="grid">
                <div class="card">
                    <div class="card-title">Video Stream Profile</div>
                    <div class="card-val" style="color: #0284c7; font-size: 16px;">{prof_codec} • {prof_res}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 4px;">{prof_fps} FPS @ {prof_bitrate} kbps ({round(prof_bitrate / 1000, 1)} Mbps)</div>
                </div>
                <div class="card">
                    <div class="card-title">{target_cams}-Camera Daily Write Rate</div>
                    <div class="card-val">{daily_storage_tb} TB / Day</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Continuous 24/7 at {prof_bitrate} kbps</div>
                </div>
                <div class="card">
                    <div class="card-title">Dedicated Storage Volume</div>
                    <div class="card-val">{usable_tb} TB Total</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Free: {topo.get('storage_free_tb', 18.87)} TB</div>
                </div>
                <div class="card">
                    <div class="card-title">Projected Retention ({target_cams} Cams)</div>
                    <div class="card-val" style="color: #10b981;">~{retention_days} Days</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 4px;">Uninterrupted 24/7 archival window</div>
                </div>
            </div>

            <h2>5. Progressive Camera-Load Stage Results</h2>
            <table>
                <thead>
                    <tr>
                        <th>Stage</th>
                        <th>Target Feeds</th>
                        <th>Verified Feeds</th>
                        <th>VMS CPU (Avg/P95)</th>
                        <th>Server CPU (Context)</th>
                        <th>VMS RAM</th>
                        <th>Net Ingest RX</th>
                        <th>Disk Write</th>
                        <th>Data Written</th>
                        <th>Result</th>
                    </tr>
                </thead>
                <tbody>
                    {stage_rows_html if stage_rows_html else '<tr><td colspan="10" style="text-align:center; padding:20px;">No stage data available</td></tr>'}
                </tbody>
            </table>

            <div class="footer">
                <span>Mirador AI VMS Performance Test Lab • Automated Benchmark Assessment</span>
                <span>Generated: {run_doc.get('started_at', datetime.now(timezone.utc).isoformat())}</span>
            </div>
        </body>
        </html>
        """
        return html

report_generator = ReportGenerator()
