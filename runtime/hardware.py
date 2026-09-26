from __future__ import annotations

import ctypes
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any


_GIB = 1024 ** 3
_MIB = 1024 ** 2


def _existing_path(path: Path) -> Path:
    candidate = path.expanduser().resolve()
    while not candidate.exists() and candidate.parent != candidate:
        candidate = candidate.parent
    return candidate


def disk_status(path: Path) -> dict[str, Any]:
    target = _existing_path(path)
    usage = shutil.disk_usage(target)
    return {
        "path": str(target),
        "total_bytes": int(usage.total),
        "used_bytes": int(usage.used),
        "free_bytes": int(usage.free),
        "free_gb": round(usage.free / _GIB, 2),
    }


def system_memory_status() -> dict[str, Any]:
    total = None
    available = None

    if os.name == "nt":
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            total = int(status.ullTotalPhys)
            available = int(status.ullAvailPhys)
    else:
        try:
            page_size = int(os.sysconf("SC_PAGE_SIZE"))
            total_pages = int(os.sysconf("SC_PHYS_PAGES"))
            available_pages = int(os.sysconf("SC_AVPHYS_PAGES"))
            total = page_size * total_pages
            available = page_size * available_pages
        except (AttributeError, OSError, ValueError):
            pass

    return {
        "total_bytes": total,
        "available_bytes": available,
        "total_gb": round(total / _GIB, 2) if total is not None else None,
        "available_gb": round(available / _GIB, 2) if available is not None else None,
    }


def nvidia_smi_path() -> str | None:
    candidates = [
        shutil.which("nvidia-smi"),
        str(Path(os.environ.get("WINDIR", r"C:\Windows")) / "System32" / "nvidia-smi.exe"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return str(Path(candidate).resolve())
    return None


def _parse_query_line(line: str) -> dict[str, Any]:
    parts = [part.strip() for part in str(line or "").split(",")]
    if len(parts) < 3:
        return {}
    name = parts[0]
    try:
        vram_mb = int(float(parts[1]))
    except (TypeError, ValueError):
        vram_mb = None
    driver = parts[2] or None
    return {
        "gpu_name": name or None,
        "vram_total_mb": vram_mb,
        "vram_total_gb": round(vram_mb / 1024, 2) if vram_mb else None,
        "driver_version": driver,
    }


def _parse_cuda_version(text: str) -> str | None:
    match = re.search(r"CUDA Version:\s*([0-9.]+)", str(text or ""), re.IGNORECASE)
    return match.group(1) if match else None


def nvidia_status(timeout: float = 4.0) -> dict[str, Any]:
    path = nvidia_smi_path()
    if not path:
        return {
            "detected": False,
            "nvidia_smi": False,
            "gpu_name": None,
            "vram_total_mb": None,
            "vram_total_gb": None,
            "driver_version": None,
            "cuda_version": None,
            "detail": "未检测到 nvidia-smi；当前 managed ComfyUI 需要 NVIDIA CUDA，需使用远程 NVIDIA Runtime。",
        }

    result: dict[str, Any] = {
        "detected": True,
        "nvidia_smi": True,
        "gpu_name": None,
        "vram_total_mb": None,
        "vram_total_gb": None,
        "driver_version": None,
        "cuda_version": None,
        "detail": "NVIDIA GPU detected",
    }
    try:
        query = subprocess.run(
            [
                path,
                "--query-gpu=name,memory.total,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            creationflags=(
                subprocess.CREATE_NO_WINDOW
                if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW")
                else 0
            ),
        )
        if query.returncode == 0 and query.stdout.strip():
            result.update(_parse_query_line(query.stdout.strip().splitlines()[0]))

        summary = subprocess.run(
            [path],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            creationflags=(
                subprocess.CREATE_NO_WINDOW
                if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW")
                else 0
            ),
        )
        if summary.returncode == 0:
            result["cuda_version"] = _parse_cuda_version(summary.stdout)
    except (OSError, subprocess.SubprocessError):
        result["detail"] = "nvidia-smi 存在但无法读取 GPU 状态。"
        return result

    gpu = result.get("gpu_name") or "NVIDIA GPU"
    vram = result.get("vram_total_gb")
    cuda = result.get("cuda_version")
    detail = gpu
    if vram:
        detail += f" · {vram:.1f} GB VRAM"
    if cuda:
        detail += f" · CUDA {cuda}"
    result["detail"] = detail
    return result


def managed_comfy_preflight(
    cache_root: Path,
    *,
    min_vram_mb: int = 0,
    min_disk_free_gb: float = 10.0,
) -> dict[str, Any]:
    gpu = nvidia_status()
    disk = disk_status(cache_root)
    vram = int(gpu.get("vram_total_mb") or 0)
    cuda_ready = bool(gpu.get("cuda_version"))
    disk_ready = float(disk["free_gb"]) >= float(min_disk_free_gb)
    vram_ready = vram >= int(min_vram_mb) if min_vram_mb else vram > 0
    supported = bool(gpu.get("detected") and cuda_ready and vram_ready and disk_ready)

    reasons: list[str] = []
    if not gpu.get("detected"):
        reasons.append("需要远程 NVIDIA Runtime：本机未检测到 NVIDIA GPU / nvidia-smi")
    elif not cuda_ready:
        reasons.append("nvidia-smi 可用，但未检测到 CUDA 运行时版本")
    if gpu.get("detected") and not vram_ready:
        reasons.append(
            f"显存不足：至少需要 {min_vram_mb / 1024:.1f} GB，"
            f"当前约 {vram / 1024:.1f} GB"
        )
    if not disk_ready:
        reasons.append(
            f"缓存磁盘不足：至少保留 {min_disk_free_gb:.1f} GB，"
            f"当前可用约 {disk['free_gb']:.1f} GB"
        )

    if not reasons:
        reasons.append(
            f"{gpu.get('detail')}; 缓存可用 {disk['free_gb']:.1f} GB"
        )

    return {
        "supported": supported,
        "backend": "managed ComfyUI Windows Portable",
        "detail": "；".join(reasons),
        "gpu": gpu,
        "disk": disk,
        "requirements": {
            "min_vram_mb": int(min_vram_mb),
            "min_vram_gb": round(min_vram_mb / 1024, 2) if min_vram_mb else None,
            "min_disk_free_gb": float(min_disk_free_gb),
        },
    }


def gguf_preflight(
    cache_root: Path,
    *,
    expected_bytes: int | None,
    partial_bytes: int = 0,
    threads: int = 1,
    reserve_bytes: int = 2 * _GIB,
) -> dict[str, Any]:
    disk = disk_status(cache_root)
    memory = system_memory_status()
    expected = int(expected_bytes or 0)
    partial = max(0, int(partial_bytes or 0))
    remaining = max(0, expected - partial) if expected else None
    required_disk = (remaining + reserve_bytes) if remaining is not None else reserve_bytes
    disk_ok = int(disk["free_bytes"]) >= required_disk
    memory_available = memory.get("available_bytes")
    memory_ok = memory_available is None or int(memory_available) >= 1 * _GIB
    threads_ok = int(threads) >= 1

    warnings: list[str] = []
    if expected and memory_available and expected > int(memory_available):
        warnings.append(
            "模型文件大于当前可用物理内存；llama.cpp 可能需要 mmap / GPU offload / 更小量化。"
        )

    reasons: list[str] = []
    if not disk_ok:
        reasons.append(
            f"缓存磁盘不足：还需模型数据和 2 GB 安全余量，当前可用 {disk['free_gb']:.1f} GB。"
        )
    if not memory_ok:
        reasons.append("当前可用物理内存低于 1 GB，拒绝启动本地模型。")
    if not threads_ok:
        reasons.append("CPU 线程数配置无效。")

    return {
        "ok": disk_ok and memory_ok and threads_ok,
        "disk": disk,
        "memory": memory,
        "threads": int(threads),
        "expected_bytes": expected_bytes,
        "partial_bytes": partial,
        "remaining_bytes": remaining,
        "required_disk_bytes": required_disk,
        "warnings": warnings,
        "reason": "；".join(reasons),
    }
