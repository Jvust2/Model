(function () {
  "use strict";

  const CACHE_KEY = "drive-model-index-v1";
  const CACHE_VERSION = 1;
  const MODEL_EXTENSIONS = new Set([
    ".gguf",
    ".safetensors",
    ".onnx",
    ".pt",
    ".pth",
    ".ckpt",
    ".bin",
    ".model",
    ".tflite"
  ]);

  const FILE_FIELDS = [
    "id",
    "name",
    "mimeType",
    "size",
    "modifiedTime",
    "md5Checksum",
    "resourceKey",
    "parents",
    "driveId",
    "capabilities"
  ];

  function storage() {
    try {
      return window.sessionStorage;
    } catch (_) {
      return null;
    }
  }

  function extensionOf(name) {
    const value = String(name || "");
    const dot = value.lastIndexOf(".");
    return dot >= 0 ? value.slice(dot).toLowerCase() : "";
  }

  function isModelFile(file) {
    if (!file || file.mimeType === "application/vnd.google-apps.folder") {
      return false;
    }
    return MODEL_EXTENSIONS.has(extensionOf(file.name));
  }

  function runnableFormat(file) {
    return extensionOf(file && file.name) === ".gguf" ? "gguf" : null;
  }

  function copyFile(file) {
    if (!file) return null;
    const out = {};
    for (const field of FILE_FIELDS) {
      if (file[field] !== undefined) out[field] = file[field];
    }
    return out;
  }

  function copyTree(node) {
    if (!node || !node.file) return null;
    return {
      file: copyFile(node.file),
      relativePath: String(node.relativePath || ""),
      scanned: node.scanned === true,
      children: (node.children || []).map(copyTree).filter(Boolean)
    };
  }

  function valid(snapshot) {
    return !!(
      snapshot &&
      snapshot.version === CACHE_VERSION &&
      snapshot.rootFolder &&
      snapshot.rootFolder.id &&
      snapshot.tree &&
      snapshot.tree.file &&
      snapshot.tree.file.id
    );
  }

  function loadSnapshot() {
    const target = storage();
    if (!target) return null;
    try {
      const raw = target.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return valid(parsed) ? parsed : null;
    } catch (error) {
      console.warn("读取模型索引失败：", error);
      return null;
    }
  }

  function saveSnapshot(rootFolder, tree, complete = true) {
    const target = storage();
    if (!target || !rootFolder || !tree) return false;
    const snapshot = {
      version: CACHE_VERSION,
      complete: complete === true,
      savedAt: Date.now(),
      rootFolder: copyFile(rootFolder),
      tree: copyTree(tree)
    };
    try {
      target.setItem(CACHE_KEY, JSON.stringify(snapshot));
      return true;
    } catch (error) {
      console.warn("保存模型索引失败：", error);
      return false;
    }
  }

  function flattenModels(rootNode) {
    const models = [];
    function walk(node) {
      if (!node) return;
      if (node.file && isModelFile(node.file)) {
        models.push({
          ...copyFile(node.file),
          relativePath: String(node.relativePath || ""),
          runnableFormat: runnableFormat(node.file)
        });
      }
      for (const child of node.children || []) walk(child);
    }
    walk(rootNode);
    return models;
  }

  function countFolders(rootNode) {
    let count = 0;
    function walk(node) {
      if (!node) return;
      if (node.file && node.file.mimeType === "application/vnd.google-apps.folder") {
        count += 1;
      }
      for (const child of node.children || []) walk(child);
    }
    walk(rootNode);
    return Math.max(0, count - 1);
  }

  window.DriveModelIndex = {
    MODEL_EXTENSIONS,
    countFolders,
    extensionOf,
    flattenModels,
    isModelFile,
    loadSnapshot,
    runnableFormat,
    saveSnapshot
  };
})();
