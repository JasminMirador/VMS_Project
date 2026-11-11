import os
import subprocess
import asyncio
import threading
import atexit
from typing import Iterator, Tuple

FFMPEG_BIN = os.environ["FFMPEG_BIN"]
_ffmpeg_dir = os.path.dirname(FFMPEG_BIN) if FFMPEG_BIN != "ffmpeg" else ""
_ffprobe_name = "ffprobe.exe" if FFMPEG_BIN.lower().endswith(".exe") else "ffprobe"
FFPROBE_BIN = os.path.join(_ffmpeg_dir, _ffprobe_name) if _ffmpeg_dir else _ffprobe_name
FFMPEG_ASYNC_LIMIT = int(os.environ.get("FFMPEG_ASYNC_LIMIT", "4"))

_async_semaphore = None
_active_processes = set()
_registry_lock = threading.Lock()

def _get_semaphore():
    global _async_semaphore
    if _async_semaphore is None:
        try:
            _async_semaphore = asyncio.Semaphore(FFMPEG_ASYNC_LIMIT)
        except RuntimeError:
            pass # Event loop not running yet
    return _async_semaphore

def register_process(proc: subprocess.Popen):
    with _registry_lock:
        _active_processes.add(proc)

def unregister_process(proc: subprocess.Popen):
    with _registry_lock:
        _active_processes.discard(proc)

def cleanup_all_processes():
    """Forcefully kill all tracked FFmpeg processes. Useful on application shutdown."""
    with _registry_lock:
        for proc in list(_active_processes):
            try:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=5)
            except Exception:
                pass
        _active_processes.clear()

atexit.register(cleanup_all_processes)

def run_ffmpeg_sync(cmd: list[str], timeout: int = 120, check: bool = False, capture_stderr: bool = True, capture_stdout: bool = False, input_data: bytes = None) -> tuple[bool, bytes, bytes]:
    """
    Run an FFmpeg command synchronously.
    Returns (success, stdout_data, stderr_data).
    """
    stderr_dest = subprocess.PIPE if capture_stderr else subprocess.DEVNULL
    stdout_dest = subprocess.PIPE if capture_stdout else subprocess.DEVNULL
    stdin_src = subprocess.PIPE if input_data is not None else None
    
    proc = subprocess.Popen(cmd, stdin=stdin_src, stdout=stdout_dest, stderr=stderr_dest)
    register_process(proc)
    
    stdout_data = b""
    stderr_data = b""
    try:
        stdout_data, stderr_data = proc.communicate(input=input_data, timeout=timeout)
        if check and proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, output=stdout_data, stderr=stderr_data)
        return proc.returncode == 0, stdout_data or b"", stderr_data or b""
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout_data, stderr_data = proc.communicate()
        if check:
            raise subprocess.TimeoutExpired(cmd, timeout, output=stdout_data, stderr=stderr_data)
        return False, stdout_data or b"", stderr_data or b""
    finally:
        unregister_process(proc)

async def run_ffmpeg_async(cmd: list[str], timeout: int = 120, check: bool = False, capture_stderr: bool = True, capture_stdout: bool = False, input_data: bytes = None) -> tuple[bool, bytes, bytes]:
    """
    Run an FFmpeg command asynchronously with concurrency limits.
    Returns (success, stdout_data, stderr_data).
    """
    sem = _get_semaphore()
    if sem:
        async with sem:
            return await _run_ffmpeg_async_internal(cmd, timeout, check, capture_stderr, capture_stdout, input_data)
    else:
        return await _run_ffmpeg_async_internal(cmd, timeout, check, capture_stderr, capture_stdout, input_data)

async def _run_ffmpeg_async_internal(cmd: list[str], timeout: int, check: bool, capture_stderr: bool, capture_stdout: bool, input_data: bytes = None) -> tuple[bool, bytes, bytes]:
    stderr_dest = asyncio.subprocess.PIPE if capture_stderr else asyncio.subprocess.DEVNULL
    stdout_dest = asyncio.subprocess.PIPE if capture_stdout else asyncio.subprocess.DEVNULL
    stdin_src = asyncio.subprocess.PIPE if input_data is not None else None
    
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=stdin_src,
        stdout=stdout_dest,
        stderr=stderr_dest
    )
    register_process(proc)
    
    stdout_data = b""
    stderr_data = b""
    try:
        stdout_data, stderr_data = await asyncio.wait_for(proc.communicate(input=input_data), timeout=timeout)
        if check and proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd, output=stdout_data, stderr=stderr_data)
        return proc.returncode == 0, stdout_data or b"", stderr_data or b""
    except asyncio.TimeoutError:
        try:
            proc.kill()
            stdout_data, stderr_data = await proc.communicate()
        except Exception:
            pass
        if check:
            raise subprocess.TimeoutExpired(cmd, timeout, output=stdout_data, stderr=stderr_data)
        return False, stdout_data or b"", stderr_data or b""
    finally:
        unregister_process(proc)

def stream_to_ffmpeg_sync(cmd: list[str], stream_generator: Iterator[bytes], timeout: int = 60) -> tuple[bool, bytes]:
    """
    Streams chunks from a generator into FFmpeg stdin synchronously.
    Handles BrokenPipeError gracefully and applies sync timeouts.
    """
    import tempfile
    
    # Use a temp file for stderr to avoid pipe deadlocks
    stderr_file = tempfile.TemporaryFile()
    
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=stderr_file,
    )
    register_process(proc)
    
    try:
        for chunk in stream_generator:
            if proc.poll() is not None:
                break
            try:
                proc.stdin.write(chunk)
            except (BrokenPipeError, OSError, ValueError):
                break
    except Exception as e:
        proc.kill()
        proc.wait(timeout=10)
        raise e
    finally:
        # IMPORTANT: Close stdin BEFORE wait() so ffmpeg receives EOF and can finish writing!
        if proc.stdin and not proc.stdin.closed:
            try:
                proc.stdin.close()
            except Exception:
                pass

        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=10)
            
        unregister_process(proc)
            
    try:
        stderr_file.seek(0)
        stderr_data = stderr_file.read()
    except Exception:
        stderr_data = b""
    finally:
        stderr_file.close()

    return proc.returncode == 0, stderr_data
