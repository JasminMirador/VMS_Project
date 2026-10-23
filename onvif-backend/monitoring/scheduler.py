import threading
import asyncio
import time
from .health import check_all_nodes, save_discovered_nodes
from .scanner import scanner
from .inference import run_root_cause_analysis


class MonitoringScheduler:
    def __init__(self, interval=15):
        self.interval = interval
        self.stop_event = threading.Event()
        self.thread = None

    def _loop(self):
        print(f"[MONITOR] Background monitoring started (interval={self.interval}s)")
        last_logged_time = 0
        while not self.stop_event.is_set():
            try:
                check_all_nodes()
                run_root_cause_analysis()
                
                current_time = time.time()
                if current_time - last_logged_time >= 600:
                    try:
                        from .diagnostics_logger import log_diagnostics
                        log_diagnostics()
                        last_logged_time = current_time
                    except Exception as diag_err:
                        print(f"[MONITOR] Diagnostics logging failed: {diag_err}")
            except Exception as e:
                print(f"[MONITOR] Error in monitoring loop: {e}")

            self.stop_event.wait(self.interval)



    def start(self):
        if self.thread and self.thread.is_alive():
            return

        # ── Seed cameras into infrastructure_nodes first ──────────────────
        def seed_task():
            try:
                from .health import seed_topology_from_cameras
                seed_topology_from_cameras()
            except Exception as e:
                print(f"[MONITOR] Seeding failed: {e}")

        seed_thread = threading.Thread(target=seed_task, daemon=True)
        seed_thread.start()


        # ── Start the main node-status monitoring loop ────────────────────
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

        # ── Start continuous network discovery watcher ───────────────────
        try:
            from .network_discovery import discovery_manager
            discovery_manager.start_watcher()
        except Exception as e:
            print(f"[MONITOR] Failed to start discovery watcher: {e}")

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)
        try:
            from .network_discovery import discovery_manager
            discovery_manager.stop_watcher()
        except Exception:
            pass

    def trigger_scan(self, subnet=None):
        """Runs a full network scan using discovery_manager so it never blocks."""
        from .network_discovery import discovery_manager
        return discovery_manager.trigger_scan(subnet)


scheduler = MonitoringScheduler()
