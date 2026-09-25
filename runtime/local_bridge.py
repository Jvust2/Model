from __future__ import annotations

import atexit
import json
import os
import subprocess
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
BRIDGE_PORT = int(os.environ.get("MODEL_BRIDGE_PORT", "8765"))
MODEL_SERVER_PORT = int(os.environ.get("MODEL_SERVER_PORT", "8080"))
LLAMA_SERVER_PATH = os.environ.get("LLAMA_SERVER_PATH", "llama-server")
MODEL_DRIVE_ROOT = os.environ.get("MODEL_DRIVE_ROOT", "")
MODEL_GPU_LAYERS = int(os.environ.get("MODEL_GPU_LAYERS", "0"))
MODEL_THREADS = int(
    os.environ.get(
        "MODEL_THREADS",
        str(max(1, (os.cpu_count() or 4) - 2)),
    )
)
MODEL_NO_MMAP = os.environ.get("MODEL_NO_MMAP", "1").lower() not in {
    "0",
    "false",
    "no",
}
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


class RuntimeState:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.process: subprocess.Popen[str] | None = None
        self.model: str | None = None
        self.model_path: str | None = None
        self.started_at: float | None = None
        self.logs: deque[str] = deque(maxlen=200)

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
            return {
                "running": running,
                "pid": process.pid if running and process else None,
                "model": self.model if running else None,
                "model_path": self.model_path if running else None,
                "started_at": self.started_at if running else None,
                "server_url": f"http://127.0.0.1:{MODEL_SERVER_PORT}" if running else None,
                "cpu_threads": MODEL_THREADS,
                "gpu_layers": MODEL_GPU_LAYERS,
                "no_mmap": MODEL_NO_MMAP,
                "logs": list(self.logs),
            }

    def stop(self) -> None:
        with self.lock:
            process = self.process
            self.process = None
            self.model = None
            self.model_path = None
            self.started_at = None

        if not process or process.poll() is not None:
            return

        self.append_log("Stopping llama-server...")
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    def start(self, model_path: Path, model_name: str) -> dict:
        self.stop()

        command = [
            LLAMA_SERVER_PATH,
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
        ]
        if MODEL_NO_MMAP:
            command.append("--no-mmap")

        creationflags = 0
        if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
            creationflags = subprocess.CREATE_NO_WINDOW

        self.append_log("Launching: " + " ".join(command))

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
            self.process = process
            self.model = model_name
            self.model_path = str(model_path)
            self.started_at = time.time()

        thread = threading.Thread(
            target=self._read_output,
            args=(process,),
            daemon=True,
        )
        thread.start()

        time.sleep(0.25)
        if process.poll() is not None:
            raise RuntimeError(
                "llama-server exited immediately. Check LLAMA_SERVER_PATH and runtime logs."
            )

        return self.snapshot()

    def _read_output(self, process: subprocess.Popen[str]) -> None:
        if not process.stdout:
            return
        for line in process.stdout:
            self.append_log(line)


STATE = RuntimeState()
atexit.register(STATE.stop)


def safe_model_path(relative_path: str) -> Path:
    if not MODEL_DRIVE_ROOT:
        raise ValueError("MODEL_DRIVE_ROOT is not configured.")

    relative = str(relative_path or "").replace("/", os.sep)
    candidate_rel = Path(relative)

    if candidate_rel.is_absolute() or ".." in candidate_rel.parts:
        raise ValueError("Invalid relative model path.")

    root = Path(MODEL_DRIVE_ROOT).expanduser().resolve()
    candidate = (root / candidate_rel).resolve()

    try:
        common = os.path.commonpath([str(root), str(candidate)])
    except ValueError as exc:
        raise ValueError("Model path escapes MODEL_DRIVE_ROOT.") from exc

    if os.path.normcase(common) != os.path.normcase(str(root)):
        raise ValueError("Model path escapes MODEL_DRIVE_ROOT.")

    if candidate.suffix.lower() != ".gguf":
        raise ValueError("v0.1 only launches GGUF models.")

    if not candidate.exists() or not candidate.is_file():
        raise FileNotFoundError(
            "Model file is not visible at the mounted Drive path: " + str(candidate)
        )

    return candidate


class Handler(BaseHTTPRequestHandler):
    server_version = "DriveModelBridge/0.1"

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
        if length < 0 or length > 65536:
            raise ValueError("Request body too large.")
        raw = self.rfile.read(length) if length else b"{}"
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("JSON body must be an object.")
        return value

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
            self._json(200, {"ok": True, "service": "Drive Model Local Runtime"})
            return

        if path == "/v1/runtime":
            if not self._origin_allowed():
                self._json(403, {"error": "Origin not allowed."})
                return
            payload = STATE.snapshot()
            payload.update(
                {
                    "drive_root_configured": bool(MODEL_DRIVE_ROOT),
                    "bridge_port": BRIDGE_PORT,
                }
            )
            self._json(200, payload)
            return

        self._json(404, {"error": "Not found."})

    def do_POST(self) -> None:
        if not self._origin_allowed():
            self._json(403, {"error": "Origin not allowed."})
            return

        path = urlparse(self.path).path

        try:
            payload = self._read_json()

            if path == "/v1/models/start":
                relative_path = str(payload.get("relative_path") or "")
                model_name = str(payload.get("name") or Path(relative_path).name)
                model_path = safe_model_path(relative_path)
                result = STATE.start(model_path, model_name)
                self._json(
                    200,
                    {
                        "ok": True,
                        "pid": result["pid"],
                        "model": result["model"],
                        "server_url": result["server_url"],
                    },
                )
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
    print("Drive Model Local Runtime")
    print(f"Bridge: http://{HOST}:{BRIDGE_PORT}")
    print("Drive root:", MODEL_DRIVE_ROOT or "(not configured)")
    print("llama-server:", LLAMA_SERVER_PATH)
    print("CPU threads:", MODEL_THREADS)
    print("GPU layers:", MODEL_GPU_LAYERS)
    print("no-mmap:", MODEL_NO_MMAP)
    print("Allowed origins:", ", ".join(sorted(ALLOWED_ORIGINS)))

    server = ThreadingHTTPServer((HOST, BRIDGE_PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STATE.stop()
        server.server_close()


if __name__ == "__main__":
    main()
