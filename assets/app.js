(function () {
  "use strict";

  let accessToken = null;
  let models = [];
  let runtimeBase = "";
  let runtimeState = null;

  const $ = id => document.getElementById(id);

  function setStatus(text) {
    $("status").textContent = text;
  }

  function showError(error) {
    $("error").textContent = error ? String(error.message || error) : "";
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "大小未知";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return size.toFixed(index >= 3 ? 2 : 1) + " " + units[index];
  }

  function extension(name) {
    return window.DriveModelIndex.extensionOf(name).replace(".", "").toUpperCase() || "FILE";
  }

  function runtimeUrl(path) {
    return runtimeBase.replace(/\/$/, "") + path;
  }

  async function refreshRuntime() {
    try {
      const response = await fetch(runtimeUrl("/v1/runtime"), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      runtimeState = await response.json();
      $("runtimeState").textContent = runtimeState.running
        ? "运行中 · " + (runtimeState.model || "GGUF")
        : "已连接 · 当前空闲";
      $("stopBtn").disabled = !runtimeState.running;
      if (runtimeState.logs && runtimeState.logs.length) {
        $("runtimeLog").textContent = runtimeState.logs.slice(-12).join("\n");
      }
      return true;
    } catch (_) {
      runtimeState = null;
      $("runtimeState").textContent = "未连接本地 Runtime";
      $("stopBtn").disabled = true;
      return false;
    }
  }

  function saveRuntimeBase() {
    runtimeBase = $("runtimeUrl").value.trim() || window.MODEL_CONFIG.runtimeBase;
    localStorage.setItem("model_runtime_base", runtimeBase);
    $("runtimeUrl").value = runtimeBase;
  }

  function renderModels() {
    const list = $("modelList");
    const count = $("modelCount");
    list.textContent = "";
    count.textContent = models.length + " 个模型文件";

    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "还没有模型索引。连接 Drive 后扫描模型文件夹。";
      list.appendChild(empty);
      return;
    }

    for (const model of models) {
      const card = document.createElement("article");
      card.className = "model-card";

      const head = document.createElement("div");
      head.className = "model-card-head";

      const titleWrap = document.createElement("div");
      titleWrap.className = "model-title-wrap";

      const format = document.createElement("span");
      format.className = "format-badge";
      format.textContent = extension(model.name);

      const title = document.createElement("div");
      title.className = "model-title";
      title.textContent = model.name;

      titleWrap.append(format, title);

      const size = document.createElement("div");
      size.className = "model-size";
      size.textContent = formatBytes(model.size);

      head.append(titleWrap, size);

      const path = document.createElement("div");
      path.className = "model-path";
      path.textContent = model.relativePath;

      const actions = document.createElement("div");
      actions.className = "model-actions";

      const probe = document.createElement("button");
      probe.type = "button";
      probe.dataset.icon = "chart";
      probe.textContent = "Range 测试";
      probe.addEventListener("click", async () => {
        showError("");
        probe.disabled = true;
        try {
          if (!accessToken) {
            accessToken = await window.DriveModelClient.getAccessToken();
          }
          if (!accessToken) throw new Error("请先连接 Google Drive。");
          const result = await window.DriveModelClient.probeRange(model, accessToken);
          setStatus("Drive Range 成功 · " + result.bytes + " bytes");
        } catch (error) {
          showError(error);
        } finally {
          probe.disabled = false;
        }
      });

      actions.appendChild(probe);

      const launch = document.createElement("button");
      launch.type = "button";
      launch.dataset.icon = "play";
      launch.textContent = model.runnableFormat === "gguf" ? "本机启动" : "暂不支持运行";
      launch.className = model.runnableFormat === "gguf" ? "primary" : "";
      launch.disabled = model.runnableFormat !== "gguf";
      launch.addEventListener("click", () => startModel(model));
      actions.appendChild(launch);

      card.append(head, path, actions);
      list.appendChild(card);
    }
  }

  async function scanDrive() {
    showError("");
    const button = $("scanBtn");
    button.disabled = true;

    try {
      if (!accessToken) {
        accessToken = await window.DriveModelClient.getAccessToken();
      }
      if (!accessToken) throw new Error("尚未获得 Google Drive 授权。");

      const rootId = $("folderId").value.trim() || "root";
      localStorage.setItem("model_drive_root_id", rootId);

      const result = await window.DriveModelClient.scanModelTree(
        accessToken,
        rootId,
        progress => {
          setStatus(
            "扫描中 · " +
              progress.scannedFolders +
              " 文件夹 · " +
              progress.modelFiles +
              " 模型"
          );
        }
      );

      window.DriveModelIndex.saveSnapshot(result.rootFolder, result.tree, true);
      models = window.DriveModelIndex.flattenModels(result.tree);
      renderModels();
      setStatus(
        "扫描完成 · " +
          result.scannedFolders +
          " 文件夹 · " +
          result.modelFiles +
          " 模型"
      );
    } catch (error) {
      showError(error);
      setStatus("扫描失败");
    } finally {
      button.disabled = false;
    }
  }

  async function startModel(model) {
    showError("");
    saveRuntimeBase();
    setStatus("正在请求本机 Runtime…");

    try {
      const response = await fetch(runtimeUrl("/v1/models/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drive_file_id: model.id,
          name: model.name,
          relative_path: model.relativePath,
          size: Number(model.size || 0),
          format: model.runnableFormat
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Runtime 启动失败：" + response.status);
      }

      setStatus("本机模型已启动 · PID " + data.pid);
      await refreshRuntime();
    } catch (error) {
      showError(error);
      setStatus("本机 Runtime 启动失败");
    }
  }

  async function stopModel() {
    showError("");
    saveRuntimeBase();
    try {
      const response = await fetch(runtimeUrl("/v1/models/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "停止失败");
      setStatus("本机模型已停止");
      await refreshRuntime();
    } catch (error) {
      showError(error);
    }
  }

  async function init() {
    window.DriveModelClient.captureOAuthSession();
    await window.DriveModelClient.registerServiceWorker();

    $("folderId").value = localStorage.getItem("model_drive_root_id") || "root";
    runtimeBase =
      localStorage.getItem("model_runtime_base") ||
      window.MODEL_CONFIG.runtimeBase ||
      "http://127.0.0.1:8765";
    $("runtimeUrl").value = runtimeBase;

    const snapshot = window.DriveModelIndex.loadSnapshot();
    if (snapshot) {
      models = window.DriveModelIndex.flattenModels(snapshot.tree);
      renderModels();
      setStatus("已恢复上次模型索引 · " + models.length + " 个文件");
    } else {
      renderModels();
    }

    accessToken = await window.DriveModelClient.getAccessToken();
    $("loginBtn").textContent = accessToken ? "Drive 已连接" : "连接 Google Drive";
    if (accessToken) {
      await window.DriveModelClient.setServiceWorkerToken(accessToken);
      if (!snapshot) setStatus("Google Drive 已连接");
    }

    await refreshRuntime();
  }

  $("loginBtn").addEventListener("click", () => {
    try {
      window.DriveModelClient.authorizeDrive();
    } catch (error) {
      showError(error);
    }
  });
  $("scanBtn").addEventListener("click", scanDrive);
  $("runtimeCheckBtn").addEventListener("click", async () => {
    saveRuntimeBase();
    const ok = await refreshRuntime();
    setStatus(ok ? "本机 Runtime 已连接" : "无法连接本机 Runtime");
  });
  $("stopBtn").addEventListener("click", stopModel);

  init().catch(showError);
})();
