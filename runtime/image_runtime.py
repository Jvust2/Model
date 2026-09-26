from __future__ import annotations

import json
import os
import shutil
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Callable

try:
    from .drive_cache import DriveCache, DriveFileSpec, default_cache_root
    from .video_runtime import COMFY_BASE, json_request, nvidia_available
except ImportError:
    from drive_cache import DriveCache, DriveFileSpec, default_cache_root
    from video_runtime import COMFY_BASE, json_request, nvidia_available


IMAGE_TIMEOUT_SECONDS = int(os.environ.get("MODEL_IMAGE_TIMEOUT_SECONDS", "3600"))
IMAGE_ROOT = Path(
    os.environ.get("MODEL_IMAGE_ROOT", str(default_cache_root() / "image"))
).expanduser().resolve()
IMAGE_OUTPUT_ROOT = IMAGE_ROOT / "outputs"

PONY_CHECKPOINT = "ponyDiffusionV6XL_v6StartWithThisOne.safetensors"
PONY_MIN_BYTES = 6_000_000_000

ADAPTERS = {
    "pony_diffusion_v6_xl": {
        "label": "Pony Diffusion V6 XL",
        "match": (
            "pony_diffusion_v6_xl",
            "pony diffusion v6 xl",
            "pony-diffusion-v6-xl",
            "snupihog__pony_diffusion_v6_xl",
        ),
        "checkpoint": PONY_CHECKPOINT,
        "min_bytes": PONY_MIN_BYTES,
        "defaults": {
            "width": 1024,
            "height": 1024,
            "steps": 28,
            "cfg": 5.0,
            "clip_skip": 2,
            "sampler_name": "euler_ancestral",
            "scheduler": "normal",
        },
    }
}


def adapter_for(name: str, model_id: str = "", package_path: str = "") -> tuple[str, dict] | None:
    hay = f"{model_id} {name} {package_path}".strip().lower()
    for key, adapter in ADAPTERS.items():
        if any(token in hay for token in adapter["match"]):
            return key, adapter
    return None


def managed_comfy_hardware() -> dict:
    if os.name != "nt":
        return {
            "supported": True,
            "backend": "managed ComfyUI",
            "detail": "non-Windows source/test environment",
        }
    supported = nvidia_available()
    return {
        "supported": supported,
        "backend": "managed ComfyUI Windows Portable",
        "detail": (
            "NVIDIA GPU/driver detected"
            if supported
            else "需要 NVIDIA GPU/驱动；当前 managed ComfyUI 为 CUDA Windows 版本"
        ),
    }


def _normalize_file_payload(item: dict) -> dict:
    return {
        "drive_file_id": item.get("drive_file_id") or item.get("id") or "",
        "file_name": item.get("file_name") or item.get("name") or "",
        "size": item.get("size"),
        "md5_checksum": item.get("md5_checksum") or item.get("md5Checksum"),
        "resource_key": item.get("resource_key") or item.get("resourceKey"),
    }


def checkpoint_spec(payload: dict, adapter: dict) -> DriveFileSpec:
    files = payload.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("图像任务缺少 Drive 模型文件列表；请重新扫描 AI-Model-Vault。")

    expected = str(adapter["checkpoint"]).lower()
    candidates = []
    for raw in files:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("file_name") or raw.get("name") or "").strip()
        if name.lower() == expected:
            spec = DriveFileSpec.from_payload(_normalize_file_payload(raw))
            if spec.size is not None and spec.size < int(adapter["min_bytes"]):
                raise ValueError("Pony checkpoint 文件大小异常，Drive 文件可能不完整。")
            return spec
        if name.lower().endswith(".safetensors"):
            try:
                spec = DriveFileSpec.from_payload(_normalize_file_payload(raw))
            except ValueError:
                continue
            candidates.append(spec)

    if candidates:
        largest = max(candidates, key=lambda spec: int(spec.size or 0))
        if int(largest.size or 0) >= int(adapter["min_bytes"]):
            return largest

    raise FileNotFoundError(
        f"Drive 模型包中没有找到完整 checkpoint：{adapter['checkpoint']}"
    )


def _bounded_int(payload: dict, key: str, default: int, minimum: int, maximum: int, step: int | None = None) -> int:
    try:
        value = int(payload.get(key, default))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be an integer.") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{key} must be between {minimum} and {maximum}.")
    if step and value % step:
        raise ValueError(f"{key} must be divisible by {step}.")
    return value


def _bounded_float(payload: dict, key: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(payload.get(key, default))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be a number.") from exc
    if not minimum <= value <= maximum:
        raise ValueError(f"{key} must be between {minimum} and {maximum}.")
    return value


def build_prompt(checkpoint_name: str, payload: dict, adapter: dict, job_id: str) -> dict:
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("请先填写图像提示词。")
    if len(prompt) > 12000:
        raise ValueError("图像提示词过长。")

    negative = str(payload.get("negative_prompt") or payload.get("negative") or "").strip()
    if len(negative) > 6000:
        raise ValueError("负面提示词过长。")

    defaults = adapter["defaults"]
    width = _bounded_int(payload, "width", defaults["width"], 512, 1536, 64)
    height = _bounded_int(payload, "height", defaults["height"], 512, 1536, 64)
    steps = _bounded_int(payload, "steps", defaults["steps"], 1, 80)
    cfg = _bounded_float(payload, "cfg", defaults["cfg"], 0.0, 20.0)

    seed_raw = payload.get("seed")
    if seed_raw in (None, ""):
        seed = int.from_bytes(os.urandom(8), "big") & ((1 << 63) - 1)
    else:
        try:
            seed = int(seed_raw)
        except (TypeError, ValueError) as exc:
            raise ValueError("seed must be an integer.") from exc
        if seed < 0 or seed >= (1 << 63):
            raise ValueError("seed must be between 0 and 2^63-1.")

    clip_layer = -abs(int(defaults.get("clip_skip", 2)))

    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": checkpoint_name},
        },
        "2": {
            "class_type": "CLIPSetLastLayer",
            "inputs": {
                "clip": ["1", 1],
                "stop_at_clip_layer": clip_layer,
            },
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["2", 0]},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative, "clip": ["2", 0]},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": defaults["sampler_name"],
                "scheduler": defaults["scheduler"],
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["3", 0],
                "negative": ["4", 0],
                "latent_image": ["5", 0],
            },
        },
        "7": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["6", 0], "vae": ["1", 2]},
        },
        "8": {
            "class_type": "SaveImage",
            "inputs": {
                "filename_prefix": f"image/jvust_{job_id}",
                "images": ["7", 0],
            },
        },
    }


class ImageRuntime:
    def __init__(
        self,
        comfy_runtime,
        drive_cache: DriveCache,
        token_provider: Callable[[], str],
    ) -> None:
        self.comfy = comfy_runtime
        self.drive_cache = drive_cache
        self.token_provider = token_provider
        self.lock = threading.RLock()
        self.job_thread: threading.Thread | None = None
        self.cancel = threading.Event()
        self.logs: deque[str] = deque(maxlen=300)
        IMAGE_ROOT.mkdir(parents=True, exist_ok=True)
        IMAGE_OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
        self.reset_state()

    def reset_state(self) -> None:
        self.job_id: str | None = None
        self.model: str | None = None
        self.adapter: str | None = None
        self.phase = "idle"
        self.detail = ""
        self.current_file: str | None = None
        self.downloaded_bytes = 0
        self.download_total_bytes: int | None = None
        self.prompt_id: str | None = None
        self.output_path: str | None = None
        self.error: str | None = None
        self.started_at: float | None = None
        self.finished_at: float | None = None

    def log(self, message: str) -> None:
        value = str(message).strip()
        if value:
            with self.lock:
                self.logs.append(value)

    def _set_phase(self, phase: str, detail: str = "") -> None:
        with self.lock:
            self.phase = phase
            self.detail = detail
        self.log(f"{phase}: {detail}")

    def snapshot(self) -> dict:
        with self.lock:
            total = self.download_total_bytes
            progress = (
                min(1.0, self.downloaded_bytes / total)
                if total and total > 0
                else None
            )
            running = bool(
                self.job_thread
                and self.job_thread.is_alive()
                and self.phase not in {"complete", "failed", "cancelled"}
            )
            return {
                "job_id": self.job_id,
                "model": self.model,
                "adapter": self.adapter,
                "phase": self.phase,
                "detail": self.detail,
                "running": running,
                "current_file": self.current_file,
                "downloaded_bytes": self.downloaded_bytes,
                "download_total_bytes": self.download_total_bytes,
                "download_progress": progress,
                "prompt_id": self.prompt_id,
                "output_ready": bool(
                    self.output_path and Path(self.output_path).exists()
                ),
                "output_name": (
                    Path(self.output_path).name if self.output_path else None
                ),
                "error": self.error,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "logs": list(self.logs)[-30:],
                "hardware": managed_comfy_hardware(),
                "supported_adapters": [
                    {"id": key, "label": value["label"]}
                    for key, value in ADAPTERS.items()
                ],
            }

    def start(self, payload: dict) -> dict:
        name = str(payload.get("name") or payload.get("model_name") or "")
        model_id = str(payload.get("model_id") or "")
        package_path = str(payload.get("package_path") or "")
        matched = adapter_for(name, model_id, package_path)
        if not matched:
            raise ValueError("这个图像模型还没有网页自动运行适配器。")
        adapter_key, adapter = matched

        hardware = managed_comfy_hardware()
        if not hardware["supported"]:
            raise RuntimeError(
                "硬件不支持：当前图像自动运行使用 managed ComfyUI CUDA 版本，"
                "需要 NVIDIA GPU/驱动。"
            )

        if self.comfy.snapshot().get("running"):
            raise RuntimeError("已有视频任务正在使用 ComfyUI，请先等待或停止视频任务。")

        self.token_provider()
        checkpoint_spec(payload, adapter)

        with self.lock:
            if self.job_thread and self.job_thread.is_alive():
                raise RuntimeError("已有图像任务正在运行。")
            self.cancel.clear()
            self.reset_state()
            self.job_id = uuid.uuid4().hex
            self.model = name or adapter["label"]
            self.adapter = adapter_key
            self.phase = "starting"
            self.detail = "正在准备图像运行环境"
            self.started_at = time.time()
            job_id = self.job_id

        thread = threading.Thread(
            target=self._run_job,
            args=(job_id, adapter_key, dict(payload)),
            daemon=True,
        )
        with self.lock:
            self.job_thread = thread
        thread.start()
        return self.snapshot()

    def stop(self) -> dict:
        self.cancel.set()
        try:
            json_request(COMFY_BASE + "/interrupt", method="POST", payload={}, timeout=2)
        except Exception:
            pass
        with self.lock:
            if self.phase not in {"idle", "complete", "failed"}:
                self.phase = "cancelled"
                self.detail = "图像任务已取消"
                self.finished_at = time.time()
        return self.snapshot()

    def shutdown(self) -> None:
        self.cancel.set()

    def output_file(self, job_id: str) -> Path:
        with self.lock:
            if not self.job_id or job_id != self.job_id or not self.output_path:
                raise FileNotFoundError("图像输出不存在。")
            path = Path(self.output_path).resolve()
        root = IMAGE_OUTPUT_ROOT.resolve()
        if os.path.commonpath([str(root), str(path)]) != str(root):
            raise ValueError("非法图像输出路径。")
        if not path.exists() or not path.is_file():
            raise FileNotFoundError("图像输出文件不存在。")
        return path

    def _progress(self, downloaded: int, total: int | None) -> None:
        if self.cancel.is_set():
            raise RuntimeError("任务已取消。")
        with self.lock:
            self.downloaded_bytes = int(downloaded)
            self.download_total_bytes = int(total) if total else None

    def _install_checkpoint(self, comfy_root: Path, spec: DriveFileSpec, token: str) -> str:
        self._set_phase("downloading_model", f"准备 Drive checkpoint：{spec.name}")
        with self.lock:
            self.current_file = spec.name
        cached = self.drive_cache.download(spec, token, progress=self._progress)

        destination = (
            comfy_root / "ComfyUI" / "models" / "checkpoints" / spec.name
        )
        destination.parent.mkdir(parents=True, exist_ok=True)

        if destination.exists():
            if destination.stat().st_size == cached.stat().st_size:
                return destination.name
            destination.unlink()

        try:
            os.link(cached, destination)
            self.log(f"Linked checkpoint into ComfyUI: {destination.name}")
        except OSError:
            shutil.copy2(cached, destination)
            self.log(f"Copied checkpoint into ComfyUI: {destination.name}")
        return destination.name

    def _history(self, prompt_id: str) -> dict | None:
        try:
            data = json_request(COMFY_BASE + "/history/" + prompt_id, timeout=10)
        except Exception:
            return None
        if not isinstance(data, dict):
            return None
        return data.get(prompt_id) or None

    def _resolve_image(self, comfy_root: Path, entry: dict, started: float) -> Path:
        outputs = entry.get("outputs") or {}
        for node in outputs.values():
            if not isinstance(node, dict):
                continue
            for image in node.get("images") or []:
                if not isinstance(image, dict) or not image.get("filename"):
                    continue
                filename = str(image["filename"])
                subfolder = str(image.get("subfolder") or "")
                folder_type = str(image.get("type") or "output")
                base = (
                    comfy_root
                    / "ComfyUI"
                    / ("output" if folder_type == "output" else folder_type)
                )
                candidate = (base / subfolder / filename).resolve()
                if candidate.exists() and candidate.is_file():
                    return candidate

        output_dir = comfy_root / "ComfyUI" / "output"
        candidates: list[Path] = []
        if output_dir.exists():
            for ext in ("*.png", "*.jpg", "*.jpeg", "*.webp"):
                candidates.extend(output_dir.rglob(ext))
        candidates = [
            path
            for path in candidates
            if path.is_file() and path.stat().st_mtime >= started - 5
        ]
        if not candidates:
            raise RuntimeError("ComfyUI 已完成，但没有找到生成的图像文件。")
        return max(candidates, key=lambda path: path.stat().st_mtime)

    def _wait_for_result(self, comfy_root: Path, prompt_id: str, started: float) -> Path:
        deadline = time.time() + IMAGE_TIMEOUT_SECONDS
        while time.time() < deadline:
            if self.cancel.is_set():
                raise RuntimeError("任务已取消。")
            entry = self._history(prompt_id)
            if entry:
                status = entry.get("status") or {}
                status_str = str(status.get("status_str") or "").lower()
                if status_str == "error":
                    messages = status.get("messages") or []
                    raise RuntimeError(
                        "ComfyUI 图像生成失败："
                        + json.dumps(messages[-5:], ensure_ascii=False)
                    )
                if entry.get("outputs"):
                    return self._resolve_image(comfy_root, entry, started)
            time.sleep(1.5)
        raise RuntimeError("图像生成超时。")

    def _run_job(self, job_id: str, adapter_key: str, payload: dict) -> None:
        try:
            adapter = ADAPTERS[adapter_key]
            spec = checkpoint_spec(payload, adapter)
            token = self.token_provider()

            self._set_phase("preparing_comfyui", "正在准备 managed ComfyUI")
            portable, _, _ = self.comfy._ensure_comfyui()
            checkpoint_name = self._install_checkpoint(portable, spec, token)
            self.comfy._ensure_comfyui_server()

            self._set_phase("building_workflow", "正在构建 Pony SDXL 图像工作流")
            prompt = build_prompt(checkpoint_name, payload, adapter, job_id)

            self._set_phase("queued", "正在提交图像任务")
            prompt_id = self.comfy._queue_prompt(prompt)
            with self.lock:
                self.prompt_id = prompt_id

            self._set_phase("generating", "ComfyUI 正在生成图像")
            generation_started = time.time()
            source = self._wait_for_result(portable, prompt_id, generation_started)

            suffix = source.suffix.lower()
            if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
                suffix = ".png"
            output = IMAGE_OUTPUT_ROOT / f"{job_id}{suffix}"
            shutil.copy2(source, output)

            with self.lock:
                self.output_path = str(output)
                self.phase = "complete"
                self.detail = "图像生成完成"
                self.error = None
                self.finished_at = time.time()
                self.current_file = None
            self.log(f"Image complete: {output.name}")

        except Exception as error:
            with self.lock:
                if self.cancel.is_set():
                    self.phase = "cancelled"
                    self.detail = "图像任务已取消"
                else:
                    self.phase = "failed"
                    self.detail = "图像任务失败"
                self.error = str(error)
                self.finished_at = time.time()
            self.log("Image error: " + repr(error))
