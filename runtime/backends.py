from __future__ import annotations

import importlib.util
import os
import shutil
from pathlib import Path

try:
    from .model_capabilities import capability_for
except ImportError:
    from model_capabilities import capability_for

BACKEND_LABELS = {
    "llama.cpp": "llama.cpp",
    "ComfyUI": "ComfyUI",
    "Diffusers": "Diffusers",
    "Transformers": "Transformers",
    "PyTorch": "PyTorch",
    "ONNX Runtime": "ONNX Runtime",
    "TFLite": "TFLite",
}

MODULE_REQUIREMENTS = {
    "Diffusers": ("torch", "diffusers", "safetensors"),
    "Transformers": ("torch", "transformers"),
    "PyTorch": ("torch",),
    "ONNX Runtime": ("onnxruntime",),
    "TFLite": ("tensorflow",),
}


def module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def resolve_executable(value: str | None) -> str | None:
    configured = str(value or "").strip()
    if not configured:
        return None
    expanded = os.path.expandvars(os.path.expanduser(configured))
    if os.path.dirname(expanded):
        candidate = Path(expanded)
        if candidate.exists() and candidate.is_file():
            return str(candidate.resolve())
        return None
    return shutil.which(expanded)


def comfyui_root() -> Path | None:
    raw = os.environ.get("MODEL_COMFYUI_ROOT") or os.environ.get("COMFYUI_ROOT") or ""
    if not raw.strip():
        return None
    candidate = Path(os.path.expandvars(os.path.expanduser(raw))).resolve()
    return candidate if candidate.exists() and candidate.is_dir() else None


def backend_status(llama_server_path: str | None = None) -> dict:
    modules = {
        name: module_available(name)
        for name in ("torch", "transformers", "diffusers", "safetensors", "onnxruntime", "tensorflow")
    }
    llama_path = resolve_executable(llama_server_path)
    comfy_root = comfyui_root()

    result = {
        "llama.cpp": {
            "detected": bool(llama_path),
            "automatic_launch": True,
            "detail": "llama-server detected" if llama_path else "llama-server not found",
        },
        "ComfyUI": {
            "detected": bool(comfy_root),
            "automatic_launch": False,
            "detail": "ComfyUI root detected" if comfy_root else "set MODEL_COMFYUI_ROOT",
        },
    }

    for backend, requirements in MODULE_REQUIREMENTS.items():
        missing = [name for name in requirements if not modules.get(name, False)]
        result[backend] = {
            "detected": not missing,
            "automatic_launch": False,
            "detail": "ready" if not missing else "missing: " + ", ".join(missing),
        }

    return {"backends": result, "python_modules": modules}


def model_plan(backend: str, category: str | None = None, model_id: str | None = None, name: str | None = None) -> dict:
    backend_name = str(backend or "").strip()
    category = str(category or "unknown").strip() or "unknown"

    requirements = {
        "llama.cpp": ["llama-server", "GGUF file"],
        "ComfyUI": ["ComfyUI installation", "model-specific workflow"],
        "Diffusers": ["Python", "torch", "diffusers", "safetensors", "model-specific pipeline class"],
        "Transformers": ["Python", "torch", "transformers", "model config/tokenizer/processor"],
        "PyTorch": ["Python", "torch", "model architecture/loader code"],
        "ONNX Runtime": ["Python", "onnxruntime", "task-specific preprocessing"],
        "TFLite": ["TensorFlow/TFLite runtime", "task-specific preprocessing"],
    }.get(backend_name, ["model-specific runtime adapter"])

    workspace = {
        "llm": "chat",
        "reasoning": "chat",
        "code": "chat",
        "novel": "chat",
        "multimodal": "vision",
        "ocr": "vision",
        "image": "image-generation",
        "image-anime": "image-generation",
        "image-nsfw": "image-generation",
        "image-edit": "image-edit",
        "video": "video-generation",
        "rag": "embedding",
        "timeseries": "timeseries",
    }.get(category, "generic")

    capability = capability_for(model_id=model_id, name=name, category=category)
    if backend_name == "llama.cpp" and not str(model_id or "").strip() and not str(name or "").strip():
        capability = {
            "availability": "automatic",
            "label": "可直接使用",
            "adapter": "llama.cpp",
            "reason": "GGUF 聊天后端已接入。",
        }
    automatic = capability["availability"] == "automatic"
    return {
        "backend": backend_name or "unknown",
        "category": category,
        "workspace": workspace,
        "automatic_launch": automatic,
        "availability": capability["availability"],
        "availability_label": capability["label"],
        "adapter": capability["adapter"],
        "availability_reason": capability["reason"],
        "requirements": requirements,
        "note": (
            capability["reason"]
        ),
    }
