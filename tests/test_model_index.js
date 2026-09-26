const assert = require("assert");

const store = new Map();
global.window = {
  sessionStorage: {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  }
};

require("../assets/model-index.js");

const FOLDER = "application/vnd.google-apps.folder";

function folder(name, path, children = []) {
  return {
    file: { id: "folder-" + name, name, mimeType: FOLDER },
    relativePath: path,
    children,
    scanned: true
  };
}

function file(id, name, path, size) {
  return {
    file: {
      id,
      name,
      mimeType: "application/octet-stream",
      size: String(size)
    },
    relativePath: path,
    children: [],
    scanned: true
  };
}

const tree = folder("AI-Model-Vault", "", [
  folder("video_ultra", "video_ultra", [
    folder("Wan2.2-Animate-14B", "video_ultra/Wan2.2-Animate-14B", [
      file(
        "a",
        "diffusion_pytorch_model-00001-of-00004.safetensors",
        "video_ultra/Wan2.2-Animate-14B/diffusion_pytorch_model-00001-of-00004.safetensors",
        100
      ),
      file(
        "b",
        "diffusion_pytorch_model-00002-of-00004.safetensors",
        "video_ultra/Wan2.2-Animate-14B/diffusion_pytorch_model-00002-of-00004.safetensors",
        200
      ),
      file(
        "c",
        "models_t5_umt5-xxl-enc-bf16.pth",
        "video_ultra/Wan2.2-Animate-14B/models_t5_umt5-xxl-enc-bf16.pth",
        300
      )
    ])
  ]),
  folder("llm", "llm", [
    folder("Qwen3-14B-GGUF", "llm/Qwen3-14B-GGUF", [
      file(
        "q",
        "qwen3-14b-q5_k_m.gguf",
        "llm/Qwen3-14B-GGUF/qwen3-14b-q5_k_m.gguf",
        400
      )
    ])
  ])
]);

const registry = {
  schema_version: "1.0.0",
  models: [
    {
      id: "wan22_animate_14b",
      name: "Wan2.2-Animate-14B",
      repo: "Wan-AI/Wan2.2-Animate-14B",
      category: "video",
      modality: ["animation", "video-to-video"],
      capabilities: ["character animation"],
      artifact_type: "base",
      quality_tier: "ultra",
      recommended_runtime: ["ComfyUI", "cloud GPU"],
      device_fit: {}
    },
    {
      id: "qwen3_14b_q6",
      name: "Qwen3-14B GGUF",
      repo: "Qwen/Qwen3-14B-GGUF",
      category: "llm",
      modality: ["text"],
      capabilities: ["Chinese"],
      artifact_type: "quantized-base",
      quality_tier: "main",
      recommended_runtime: ["llama.cpp", "LM Studio"],
      device_fit: {}
    },
    {
      id: "chronos_2",
      name: "Chronos-2",
      repo: "amazon/chronos-2",
      category: "timeseries",
      recommended_runtime: ["PyTorch"],
      device_fit: {}
    }
  ]
};

const packages = window.DriveModelIndex.flattenPackages(tree, registry);
assert.strictEqual(packages.length, 3);

const wan = packages.find(item => item.id === "wan22_animate_14b");
assert.ok(wan);
assert.strictEqual(wan.fileCount, 3);
assert.strictEqual(wan.totalSize, 600);
assert.strictEqual(wan.backend, "ComfyUI");
assert.strictEqual(wan.workspace, "video-generation");
assert.strictEqual(wan.directLaunch, false);

const qwen = packages.find(item => item.id === "qwen3_14b_q6");
assert.ok(qwen);
assert.strictEqual(qwen.backend, "llama.cpp");
assert.strictEqual(qwen.workspace, "chat");
assert.strictEqual(qwen.directLaunch, true);
assert.ok(qwen.relativePath.endsWith(".gguf"));

const missing = packages.find(item => item.id === "chronos_2");
assert.ok(missing);
assert.strictEqual(missing.vaultMissing, true);
assert.strictEqual(missing.fileCount, 0);
assert.strictEqual(missing.directLaunch, false);
assert.strictEqual(missing.workspace, "timeseries");

console.log("model-index package tests passed");
