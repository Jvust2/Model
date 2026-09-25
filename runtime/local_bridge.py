from __future__ import annotations

import atexit
import json
import os
import shutil
import socket
import struct
import subprocess
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

try:
    from .backends import backend_status, model_plan
    from .drive_cache import DriveCache, DriveFileSpec
    from .video_runtime import VideoRuntime, adapter_for
except ImportError:
    from backends import backend_status, model_plan
    from drive_cache import DriveCache, DriveFileSpec
    from video_runtime import VideoRuntime, adapter_for

HOST = "127.0.0.1"
BRIDGE_PORT = int(os.environ.get("MODEL_BRIDGE_PORT", "8765"))
MODEL_SERVER_PORT = int(os.environ.get("MODEL_SERVER_PORT", "8080"))
LLAMA_SERVER_PATH = os.environ.get("LLAMA_SERVER_PATH", "llama-server")
MODEL_GPU_LAYERS = int(os.environ.get("MODEL_GPU_LAYERS", "0"))
MODEL_THREADS = int(
    os.environ.get(
        "MODEL_THREADS",
        str(max(1, (os.cpu_count() or 4) - 2)),
    )
)

ALLOWED_LOAD_MODES = {"auto", "none", "mmap", "mlock", "mmap+mlock", "dio"}


def normalize_load_mode(value: str) -> str:
    mode = str(value or "none").strip().lower()
    if mode not in ALLOWED_LOAD_MODES:
        allowed = ", ".join(sorted(ALLOWED_LOAD_MODES))
        raise ValueError(f"Invalid MODEL_LOAD_MODE={value!r}. Allowed: {allowed}.")
    return mode


def positive_float_env(name: str, default: float) -> float:
    raw = os.environ.get(name, str(default))
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number.") from exc
    if value <= 0:
        raise ValueError(f"{name} must be > 0.")
    return value


MODEL_LOAD_MODE = normalize_load_mode(os.environ.get("MODEL_LOAD_MODE", "none"))
MODEL_READY_WARN_SECONDS = positive_float_env("MODEL_READY_WARN_SECONDS", 300.0)
MODEL_HEALTH_INTERVAL = positive_float_env("MODEL_HEALTH_INTERVAL", 0.5)
MODEL_CHAT_TIMEOUT = positive_float_env("MODEL_CHAT_TIMEOUT", 600.0)

DEFAULT_ORIGINS = ",".join(
    [
        "https://jvust2.github.io",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ]
)
ALLOWED_ORIGINS = {
    item.strip()
    for item in os.environ.get("MODEL_ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",")
    if item.strip()
}


def resolve_llama_server() -> str | None:
    configured = str(LLAMA_SERVER_PATH or "").strip()
    if not configured:
        return None

    expanded = os.path.expandvars(os.path.expanduser(configured))
    if os.path.dirname(expanded):
        candidate = Path(expanded)
        if candidate.exists() and candidate.is_file():
            return str(candidate.resolve())
        return None
    return shutil.which(expanded)


def inspect_gguf(model_path: Path) -> dict:
    """Read only the fixed GGUF header; never scan tensor payloads."""
    with model_path.open("rb") as handle:
        header = handle.read(24)

    if len(header) < 24:
        raise ValueError("GGUF file is too small to contain a complete header.")

    magic, version, tensor_count, metadata_kv_count = struct.unpack("<4sIQQ", header)
    if magic != b"GGUF":
        raise ValueError("File extension is .gguf but the GGUF magic header is missing.")

    return {
        "format": "gguf",
        "version": version,
        "tensor_count": tensor_count,
        "metadata_kv_count": metadata_kv_count,
        "file_size": model_path.stat().st_size,
        "header_bytes_read": len(header),
    }


def llama_health_status() -> dict:
    url = f"http://127.0.0.1:{MODEL_SERVER_PORT}/health"
    request = Request(url, method="GET")
    try:
        with urlopen(request, timeout=0.75) as response:
            status = int(response.status)
            return {"reachable": True, "ready": status == 200, "status": status}
    except HTTPError as error:
        return {"reachable": True, "ready": False, "status": int(error.code)}
    except (URLError, TimeoutError, socket.timeout, OSError):
        return {"reachable": False, "ready": False, "status": None}


class DriveSession:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.access_token: str | None = None

    def set(self, access_token: str) -> None:
        token = str(access_token or "").strip()
        if not token:
            raise ValueError("Google Drive access token is required.")
        if len(token) > 8192:
            raise ValueError("Google Drive access token is unexpectedly large.")
        with self.lock:
            self.access_token = token

    def get(self) -> str:
        with self.lock:
            if not self.access_token:
                raise PermissionError(
                    "Runtime has no Google Drive session. Reconnect Drive in the website."
                )
            return self.access_token

    def clear(self) -> None:
        with self.lock:
            self.access_token = None


DRIVE_SESSION = DriveSession()
DRIVE_CACHE = DriveCache()


def build_chat_payload(payload: dict, model_name: str | None) -> dict:
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError("messages must be a non-empty array.")
    if len(messages) > 64:
        raise ValueError("Too many chat messages; maximum is 64.")

    clean_messages = []
    total_chars = 0
    for item in messages:
        if not isinstance(item, dict):
            raise ValueError("Each chat message must be an object.")
        role = str(item.get("role") or "").strip().lower()
        if role not in {"system", "user", "assistant"}:
            raise ValueError("Chat message role must be system, user, or assistant.")
        content = item.get("content")
        if not isinstance(content, str):
            raise ValueError("Chat message content must be text.")
        total_chars += len(content)
        if total_chars > 131072:
            raise ValueError("Chat history is too large for the local bridge.")
        clean_messages.append({"role": role, "content": content})

    try:
        temperature = float(payload.get("temperature", 0.7))
    except (TypeError, ValueError) as exc:
        raise ValueError("temperature must be a number.") from exc
    if not 0 <= temperature <= 2:
        raise ValueError("temperature must be between 0 and 2.")

    try:
        max_tokens = int(payload.get("max_tokens", 512))
    except (TypeError, ValueError) as exc:
        raise ValueError("max_tokens must be an integer.") from exc
    if not 1 <= max_tokens <= 4096:
        raise ValueError("max_tokens must be between 1 and 4096.")

    return {
        "model": str(model_name or "local-model"),
        "messages": clean_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }


def llama_chat_completion(payload: dict) -> tuple[int, dict]:
    request = Request(
        f"http://127.0.0.1:{MODEL_SERVER_PORT}/v1/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer no-key",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=MODEL_CHAT_TIMEOUT) as response:
            raw = response.read()
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("llama-server returned a non-object JSON response.")
            return int(response.status), data
    except HTTPError as error:
        raw = error.read()
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            data = {"error": raw.decode("utf-8", errors="replace") or str(error)}
        if not isinstance(data, dict):
            data = {"error": str(data)}
        return int(error.code), data
    except (URLError, TimeoutError, socket.timeout, OSError) as error:
        raise RuntimeError("Could not reach llama-server: " + str(error)) from error


class RuntimeState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.process: subprocess.Popen[str] | None = None
        self.model: str | None = None
        self.model_relative_path: str | None = None
        self.source_drive_file_id: str | None = None
        self.started_at: float | None = None
        self.ready_at: float | None = None
        self.phase = "idle"
        self.last_error: str | None = None
        self.exit_code: int | None = None
        self.downloaded_bytes = 0
        self.download_total_bytes: int | None = None
        self.cache_file: str | None = None
        self.job_id = 0
        self.logs: deque[str] = deque(maxlen=300)

    def append_log(self, line: str) -> None:
        line = line.rstrip()
        if not line:
            return
        with self.lock:
            self.logs.append(line)

    def snapshot(self) -> dict:
        with self.lock:
            process = self.process
            running = bool(process and process.poll() is None)
            started_at = self.started_at if running else None
            uptime = max(0.0, time.time() - started_at) if started_at else None
            total = self.download_total_bytes
            downloaded = self.downloaded_bytes
            progress = (
                min(1.0, downloaded / total)
                if total and total > 0
                else None
            )
            return {
                "running": running,
                "ready": running and self.phase == "ready",
                "phase": self.phase,
                "pid": process.pid if running and process else None,
                "model": self.model,
                "model_relative_path": self.model_relative_path,
                "source_drive_file_id": self.source_drive_file_id,
                "started_at": started_at,
                "ready_at": self.ready_at if running else None,
                "uptime_seconds": uptime,
                "server_url": f"http://127.0.0.1:{MODEL_SERVER_PORT}" if running else None,
                "cpu_threads": MODEL_THREADS,
                "gpu_layers": MODEL_GPU_LAYERS,
                "load_mode": MODEL_LOAD_MODE,
                "downloaded_bytes": downloaded,
                "download_total_bytes": total,
                "download_progress": progress,
                "cache_file": self.cache_file,
                "last_error": self.last_error,
                "exit_code": self.exit_code,
                "logs": list(self.logs),
            }

    def stop(self) -> None:
        with self.lock:
            self.job_id += 1
            process = self.process
            self.process = None
            self.model = None
            self.model_relative_path = None
            self.source_drive_file_id = None
            self.started_at = None
            self.ready_at = None
            self.phase = "idle"
            self.last_error = None
            self.exit_code = None
            self.downloaded_bytes = 0
            self.download_total_bytes = None
            self.cache_file = None

        if not process or process.poll() is not None:
            return

        self.append_log("Stopping llama-server...")
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    def start_drive(
        self,
        spec: DriveFileSpec,
        model_name: str,
        relative_path: str,
        access_token: str,
    ) -> dict:
        self.stop()
        with self.lock:
            job_id = self.job_id
            self.model = model_name
            self.model_relative_path = relative_path
            self.source_drive_file_id = spec.file_id
            self.phase = "downloading"
            self.downloaded_bytes = 0
            self.download_total_bytes = spec.size
            self.last_error = None
            self.exit_code = None

        cached = DRIVE_CACHE.cached_path(spec)
        if cached:
            self.append_log(f"Using cached Drive model: {model_name}")
            with self.lock:
                self.downloaded_bytes = cached.stat().st_size
                self.download_total_bytes = spec.size or cached.stat().st_size
                self.cache_file = cached.name
            self._launch_cached(job_id, cached, model_name, relative_path)
            return self.snapshot()

        self.append_log(f"Downloading from Google Drive: {model_name}")
        threading.Thread(
            target=self._download_and_launch,
            args=(job_id, spec, model_name, relative_path, access_token),
            daemon=True,
        ).start()
        return self.snapshot()

    def _download_and_launch(
        self,
        job_id: int,
        spec: DriveFileSpec,
        model_name: str,
        relative_path: str,
        access_token: str,
    ) -> None:
        def progress(received: int, total: int | None) -> None:
            with self.lock:
                if self.job_id != job_id:
                    return
                self.downloaded_bytes = received
                self.download_total_bytes = total

        try:
            model_path = DRIVE_CACHE.download(spec, access_token, progress)
            with self.lock:
                if self.job_id != job_id:
                    return
                self.cache_file = model_path.name
            self.append_log(f"Drive download complete: {model_name}")
            self._launch_cached(job_id, model_path, model_name, relative_path)
        except Exception as error:
            with self.lock:
                if self.job_id != job_id:
                    return
                self.phase = "failed"
                self.last_error = str(error)
            self.append_log("Drive cache failed: " + str(error))

    def _launch_cached(
        self,
        job_id: int,
        model_path: Path,
        model_name: str,
        relative_path: str,
    ) -> None:
        if model_path.suffix.lower() != ".gguf":
            raise ValueError("llama.cpp direct launch requires a GGUF file.")

        gguf = inspect_gguf(model_path)
        executable = resolve_llama_server()
        if not executable:
            raise FileNotFoundError(
                "llama-server was not found. Set LLAMA_SERVER_PATH to llama-server.exe."
            )

        command = [
            executable,
            "-m",
            str(model_path),
            "--host",
            "127.0.0.1",
            "--port",
            str(MODEL_SERVER_PORT),
            "-t",
            str(MODEL_THREADS),
            "-ngl",
            str(MODEL_GPU_LAYERS),
            "--load-mode",
            MODEL_LOAD_MODE,
        ]

        creationflags = 0
        if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
            creationflags = subprocess.CREATE_NO_WINDOW

        self.append_log(
            "Launching llama-server from Drive cache: "
            f"model={model_name} threads={MODEL_THREADS} "
            f"gpu_layers={MODEL_GPU_LAYERS} load_mode={MODEL_LOAD_MODE}"
        )

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creationflags,
        )

        with self.lock:
            if self.job_id != job_id:
                process.terminate()
                return
            self.process = process
            self.started_at = time.time()
            self.ready_at = None
            self.phase = "loading"
            self.last_error = None
            self.exit_code = None

        threading.Thread(target=self._read_output, args=(process,), daemon=True).start()
        threading.Thread(target=self._monitor_ready, args=(process,), daemon=True).start()

        time.sleep(0.15)
        exit_code = process.poll()
        if exit_code is not None:
            message = f"llama-server exited immediately with code {exit_code}."
            self._mark_failed(process, message, exit_code)
            raise RuntimeError(message + " Check runtime logs and LLAMA_SERVER_PATH.")

        self.append_log(
            f"Cached GGUF verified: v{gguf['version']} tensors={gguf['tensor_count']}"
        )

    def _mark_failed(
        self, process: subprocess.Popen[str], message: str, exit_code: int | None = None
    ) -> None:
        with self.lock:
            if self.process is not process:
                return
            self.phase = "failed"
            self.last_error = message
            self.exit_code = exit_code
        self.append_log(message)

    def _monitor_ready(self, process: subprocess.Popen[str]) -> None:
        started = time.monotonic()
        warned = False

        while process.poll() is None:
            health = llama_health_status()
            if health["ready"]:
                with self.lock:
                    if self.process is not process:
                        return
                    self.phase = "ready"
                    self.ready_at = time.time()
                    self.last_error = None
                self.append_log("llama-server is ready (/health = 200).")
                return

            elapsed = time.monotonic() - started
            if not warned and elapsed >= MODEL_READY_WARN_SECONDS:
                warned = True
                message = (
                    f"llama-server is still loading after {MODEL_READY_WARN_SECONDS:.0f}s; "
                    "the process remains running and readiness checks continue."
                )
                with self.lock:
                    if self.process is not process:
                        return
                    self.last_error = message
                self.append_log(message)

            time.sleep(MODEL_HEALTH_INTERVAL)

        exit_code = process.poll()
        self._mark_failed(
            process,
            f"llama-server exited before becoming ready with code {exit_code}.",
            exit_code,
        )

    def _read_output(self, process: subprocess.Popen[str]) -> None:
        if process.stdout:
            for line in process.stdout:
                self.append_log(line)

        exit_code = process.poll()
        if exit_code is None:
            try:
                exit_code = process.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                return

        with self.lock:
            if self.process is not process:
                return
            was_ready = self.phase == "ready"

        if was_ready:
            self._mark_failed(
                process,
                f"llama-server exited unexpectedly with code {exit_code}.",
                exit_code,
            )


STATE = RuntimeState()
VIDEO = VideoRuntime()
atexit.register(STATE.stop)
atexit.register(VIDEO.shutdown)



class Handler(BaseHTTPRequestHandler):
    server_version = "DriveModelBridge/0.9"

    def log_message(self, format: str, *args) -> None:
        return

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin in ALLOWED_ORIGINS

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length < 0 or length > 262144:
            raise ValueError("Request body too large.")
        raw = self.rfile.read(length) if length else b"{}"
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("JSON body must be an object.")
        return value

    def _serve_video_file(self, path: Path) -> None:
        size = path.stat().st_size
        start = 0
        end = size - 1
        status = 200

        range_header = self.headers.get("Range") or ""
        if range_header.startswith("bytes="):
            value = range_header[6:].split(",", 1)[0].strip()
            left, _, right = value.partition("-")
            if left:
                start = int(left)
            if right:
                end = int(right)
            else:
                end = min(size - 1, start + 8 * 1024 * 1024 - 1)
            if start < 0 or end < start or start >= size:
                self.send_response(416)
                self._cors_headers()
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            end = min(end, size - 1)
            status = 206

        content_length = end - start + 1
        suffix = path.suffix.lower()
        content_type = {
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".mkv": "video/x-matroska",
            ".gif": "image/gif",
        }.get(suffix, "application/octet-stream")

        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(content_length))
        self.send_header("Cache-Control", "no-store")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()

        remaining = content_length
        with path.open("rb") as handle:
            handle.seek(start)
            while remaining > 0:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_OPTIONS(self) -> None:
        if not self._origin_allowed():
            self._json(403, {"error": "Origin not allowed."})
            return
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/health":
            self._json(200, {"ok": True, "service": "Drive Model Local Runtime", "version": 9})
            return

        if path == "/v1/backends":
            if not self._origin_allowed():
                self._json(403, {"error": "Origin not allowed."})
                return
            self._json(200, backend_status(LLAMA_SERVER_PATH))
            return

        if path == "/v1/runtime":
            if not self._origin_allowed():
                self._json(403, {"error": "Origin not allowed."})
                return
            payload = STATE.snapshot()
            payload.update(
                {
                    "drive_api_session": bool(DRIVE_SESSION.access_token),
                    "cache_root_label": DRIVE_CACHE.root.name,
                    "llama_server_found": resolve_llama_server() is not None,
                    "bridge_port": BRIDGE_PORT,
                    "model_server_port": MODEL_SERVER_PORT,
                    "ready_warn_seconds": MODEL_READY_WARN_SECONDS,
                    "video": VIDEO.snapshot(),
                    "runtime_version": 9,
                }
            )
            self._json(200, payload)
            return

        if path == "/v1/video/status":
            if not self._origin_allowed():
                self._json(403, {"error": "Origin not allowed."})
                return
            self._json(200, VIDEO.snapshot())
            return

        if path == "/v1/video/file":
            if not self._origin_allowed():
                self._json(403, {"error": "Origin not allowed."})
                return
            query = parse_qs(urlparse(self.path).query)
            job_id = str((query.get("job_id") or [""])[0])
            try:
                video_path = VIDEO.output_file(job_id)
                self._serve_video_file(video_path)
            except FileNotFoundError as error:
                self._json(404, {"error": str(error)})
            except ValueError as error:
                self._json(400, {"error": str(error)})
            return

        self._json(404, {"error": "Not found."})

    def do_POST(self) -> None:
        if not self._origin_allowed():
            self._json(403, {"error": "Origin not allowed."})
            return

        path = urlparse(self.path).path

        try:
            payload = self._read_json()

            if path == "/v1/chat/completions":
                snapshot = STATE.snapshot()
                if not snapshot["ready"]:
                    self._json(409, {"error": "Local model is not ready."})
                    return
                chat_payload = build_chat_payload(payload, snapshot.get("model"))
                status, result = llama_chat_completion(chat_payload)
                self._json(status, result)
                return

            if path == "/v1/models/plan":
                backend = str(payload.get("backend") or "")
                category = str(payload.get("category") or "unknown")
                plan = model_plan(backend, category)
                status = backend_status(LLAMA_SERVER_PATH)["backends"].get(
                    backend,
                    {
                        "detected": False,
                        "automatic_launch": False,
                        "detail": "unknown backend",
                    },
                )
                video_match = adapter_for(
                    str(payload.get("name") or ""),
                    str(payload.get("model_id") or ""),
                )
                plan.update(
                    {
                        "drive_api_session": bool(DRIVE_SESSION.access_token),
                        "cache_mode": "drive-api",
                        "backend_status": status,
                        "video_adapter": (
                            {
                                "id": video_match[0],
                                "automatic_launch": True,
                            }
                            if video_match
                            else None
                        ),
                    }
                )
                self._json(200, {"ok": True, "plan": plan})
                return

            if path == "/v1/drive/session":
                DRIVE_SESSION.set(str(payload.get("access_token") or ""))
                self._json(200, {"ok": True, "stored": "memory-only"})
                return

            if path == "/v1/models/cache":
                spec = DriveFileSpec.from_payload(payload)
                info = DRIVE_CACHE.describe(spec)
                self._json(200, {"ok": True, "cache": info})
                return

            if path == "/v1/models/inspect":
                spec = DriveFileSpec.from_payload(payload)
                model_path = DRIVE_CACHE.cached_path(spec)
                if not model_path:
                    self._json(
                        409,
                        {
                            "error": "Model is not cached yet. Start it once to download from Drive.",
                            "cache": DRIVE_CACHE.describe(spec),
                        },
                    )
                    return
                self._json(200, {"ok": True, "gguf": inspect_gguf(model_path)})
                return

            if path == "/v1/models/start":
                spec = DriveFileSpec.from_payload(payload)
                if Path(spec.name).suffix.lower() != ".gguf":
                    raise ValueError("Direct llama.cpp launch currently supports GGUF only.")

                model_name = str(payload.get("display_name") or payload.get("name") or spec.name)
                relative_path = str(payload.get("relative_path") or spec.name)
                token = DRIVE_SESSION.get()
                result = STATE.start_drive(
                    spec,
                    model_name,
                    relative_path,
                    token,
                )
                self._json(
                    202,
                    {
                        "ok": True,
                        "model": result["model"],
                        "phase": result["phase"],
                        "ready": result["ready"],
                        "downloaded_bytes": result["downloaded_bytes"],
                        "download_total_bytes": result["download_total_bytes"],
                        "download_progress": result["download_progress"],
                        "cache_file": result["cache_file"],
                    },
                )
                return

            if path == "/v1/video/generate":
                result = VIDEO.start(payload)
                self._json(202, {"ok": True, "video": result})
                return

            if path == "/v1/video/stop":
                self._json(200, {"ok": True, "video": VIDEO.stop()})
                return

            if path == "/v1/models/stop":
                STATE.stop()
                self._json(200, {"ok": True})
                return

            self._json(404, {"error": "Not found."})
        except FileNotFoundError as error:
            self._json(404, {"error": str(error)})
        except (ValueError, json.JSONDecodeError) as error:
            self._json(400, {"error": str(error)})
        except Exception as error:
            STATE.append_log("Bridge error: " + repr(error))
            self._json(500, {"error": str(error)})


def main() -> None:
    print("Drive Model Local Runtime v0.9")
    print(f"Bridge: http://{HOST}:{BRIDGE_PORT}")
    print("Drive source: Google Drive API (no desktop mount required)")
    print("Cache root:", DRIVE_CACHE.root)
    print("llama-server:", LLAMA_SERVER_PATH)
    print("llama-server found:", bool(resolve_llama_server()))
    print("CPU threads:", MODEL_THREADS)
    print("GPU layers:", MODEL_GPU_LAYERS)
    print("Load mode:", MODEL_LOAD_MODE)
    print("Ready warning:", f"{MODEL_READY_WARN_SECONDS:.0f}s")
    print("Allowed origins:", ", ".join(sorted(ALLOWED_ORIGINS)))

    server = ThreadingHTTPServer((HOST, BRIDGE_PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        VIDEO.shutdown()
        STATE.stop()
        server.server_close()


if __name__ == "__main__":
    main()
