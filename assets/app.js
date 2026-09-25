(function () {
  "use strict";

  let accessToken = null;
  let models = [];
  let runtimeBase = "";
  let runtimeState = null;
  let runtimePollTimer = null;
  let chatBusy = false;
  let chatHistory = [];

  const $ = id => document.getElementById(id);

  function setStatus(text) {
    $("status").textContent = text;
  }

  function showError(error) {
    $("error").textContent = error ? String(error.message || error) : "";
  }

  function setDriveState(text) {
    $("driveState").textContent = text;
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

  function clearRuntimePoll() {
    if (runtimePollTimer) {
      clearTimeout(runtimePollTimer);
      runtimePollTimer = null;
    }
  }

  function scheduleRuntimeRefresh() {
    clearRuntimePoll();
    if (runtimeState && runtimeState.running && runtimeState.phase === "loading") {
      runtimePollTimer = setTimeout(() => {
        refreshRuntime().catch(() => {});
      }, 1000);
    }
  }

  function runtimeLabel(state) {
    if (!state) return "未连接本地 Runtime";
    if (state.running && state.ready) {
      return "已就绪 · " + (state.model || "GGUF");
    }
    if (state.running && state.phase === "loading") {
      return "加载中 · " + (state.model || "GGUF");
    }
    if (state.phase === "failed") return "Runtime 异常";
    if (state.running) return "运行中 · " + (state.model || "GGUF");
    return "已连接 · 当前空闲";
  }

  function runtimeLogText(state) {
    const lines = [];
    if (state && state.last_error) lines.push("[bridge] " + state.last_error);
    if (state && state.logs && state.logs.length) {
      lines.push(...state.logs.slice(-12));
    }
    return lines.length ? lines.join("\n") : "Runtime 已连接，暂无日志。";
  }

  function updateDriveRuntimeCompatibility() {
    if (!runtimeState || !runtimeState.drive_root_label) return;

    const cloudRootName = localStorage.getItem("model_drive_root_name") || "";
    if (
      cloudRootName &&
      cloudRootName.toLowerCase() !==
        String(runtimeState.drive_root_label).toLowerCase()
    ) {
      setDriveState(
        "注意：网页 Drive 根目录是“" +
          cloudRootName +
          "”，本机 Runtime 根目录是“" +
          runtimeState.drive_root_label +
          "”。启动前请确认它们对应同一文件夹。"
      );
    }
  }

  function updateChatAvailability() {
    const ready = !!(runtimeState && runtimeState.ready);
    $("chatInput").disabled = !ready || chatBusy;
    $("sendBtn").disabled = !ready || chatBusy;
    $("chatModelLabel").textContent = ready
      ? "当前模型 · " + (runtimeState.model || "GGUF")
      : runtimeState && runtimeState.phase === "loading"
        ? "模型加载中，完成后即可聊天。"
        : "先从下方模型库启动一个 GGUF。";
  }

  async function refreshRuntime() {
    clearRuntimePoll();
    try {
      const response = await fetch(runtimeUrl("/v1/runtime"), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      runtimeState = await response.json();
      $("runtimeState").textContent = runtimeLabel(runtimeState);
      $("runtimeLog").textContent = runtimeLogText(runtimeState);
      $("stopBtn").disabled = !runtimeState.running;
      updateDriveRuntimeCompatibility();
      updateChatAvailability();
      renderModels();
      scheduleRuntimeRefresh();
      return true;
    } catch (_) {
      runtimeState = null;
      $("runtimeState").textContent = "未连接本地 Runtime";
      $("runtimeLog").textContent = "无法读取 Runtime 状态。先运行 runtime\\Model.cmd。";
      $("stopBtn").disabled = true;
      updateChatAvailability();
      return false;
    }
  }

  function saveRuntimeBase() {
    runtimeBase = $("runtimeUrl").value.trim() || window.MODEL_CONFIG.runtimeBase;
    localStorage.setItem("model_runtime_base", runtimeBase);
    $("runtimeUrl").value = runtimeBase;
  }

  function saveDriveSelection(folder) {
    if (!folder || !folder.id) return;
    $("folderId").value = folder.id;
    localStorage.setItem("model_drive_root_id", folder.id);
    localStorage.setItem("model_drive_root_name", folder.name || "");
    setDriveState("已选择 Drive 文件夹 · " + (folder.name || folder.id));
  }

  async function ensureAccessToken() {
    if (!accessToken) {
      accessToken = await window.DriveModelClient.getAccessToken();
    }
    if (!accessToken) {
      throw new Error("尚未获得 Google Drive 授权。请先点击“连接 Google Drive”。");
    }
    return accessToken;
  }

  async function findPreferredFolder(options = {}) {
    const { quiet = false, autoScan = false } = options;
    showError("");

    try {
      await ensureAccessToken();

      const folderName =
        $("folderName").value.trim() ||
        window.MODEL_CONFIG.preferredFolderName ||
        "AI-Model-Vault";

      if (!quiet) setStatus("正在寻找 Drive 文件夹 · " + folderName);

      const result = await window.DriveModelClient.findFolderByName(
        accessToken,
        folderName,
        "root"
      );

      if (!result.folder) {
        setDriveState("没有在 Drive 根目录找到“" + folderName + "”。可手动填写 folder ID。");
        if (!quiet) setStatus("未找到 " + folderName);
        return null;
      }

      saveDriveSelection(result.folder);

      if (result.matches.length > 1) {
        setDriveState(
          "找到 " +
            result.matches.length +
            " 个同名文件夹，默认选择最近修改的 · " +
            result.folder.name
        );
      }

      if (!quiet) setStatus("已找到 " + result.folder.name);
      if (autoScan) await scanDrive();
      return result.folder;
    } catch (error) {
      if (!quiet) {
        showError(error);
        setStatus("寻找 Drive 文件夹失败");
      }
      return null;
    }
  }

  function renderChat() {
    const target = $("chatMessages");
    target.textContent = "";

    if (!chatHistory.length) {
      const empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = "模型就绪后，这里就是你的本机 AI 对话窗口。";
      target.appendChild(empty);
      return;
    }

    for (const message of chatHistory) {
      const row = document.createElement("div");
      row.className = "chat-message " + message.role;

      const role = document.createElement("span");
      role.className = "chat-role";
      role.textContent = message.role === "user" ? "YOU" : "LOCAL MODEL";

      const body = document.createElement("div");
      body.textContent = message.content;

      row.append(role, body);
      target.appendChild(row);
    }

    target.scrollTop = target.scrollHeight;
  }

  function clearChat() {
    chatHistory = [];
    renderChat();
    showError("");
  }

  async function sendChat() {
    const input = $("chatInput");
    const content = input.value.trim();

    if (!content || chatBusy) return;
    if (!runtimeState || !runtimeState.ready) {
      showError("请先启动并等待本机 GGUF 模型就绪。");
      return;
    }

    chatHistory.push({ role: "user", content });
    input.value = "";
    renderChat();

    chatBusy = true;
    updateChatAvailability();
    setStatus("本机模型正在生成…");
    showError("");

    try {
      const response = await fetch(runtimeUrl("/v1/chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chatHistory,
          temperature: Number($("temperature").value || 0.7),
          max_tokens: Number($("maxTokens").value || 512)
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const upstream =
          data.error && data.error.message ? data.error.message : data.error;
        throw new Error(upstream || "生成失败：" + response.status);
      }

      const contentOut =
        data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content
          : "";

      if (!contentOut) throw new Error("模型返回了空响应。");

      chatHistory.push({
        role: "assistant",
        content: String(contentOut)
      });
      renderChat();
      setStatus("本机模型回复完成");
    } catch (error) {
      showError(error);
      setStatus("本机模型生成失败");
    } finally {
      chatBusy = false;
      updateChatAvailability();
      input.focus();
    }
  }

  async function inspectModel(model, button) {
    showError("");
    saveRuntimeBase();
    button.disabled = true;
    setStatus("正在检查本机 GGUF 文件…");

    try {
      const response = await fetch(runtimeUrl("/v1/models/inspect"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relative_path: model.relativePath
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.error ||
            "本机找不到对应模型。请确认 Model.cmd 选择的本机 Drive 根目录，与网页当前 Drive 文件夹是同一个目录。"
        );
      }

      const info = data.gguf || {};
      setStatus(
        "GGUF v" +
          info.version +
          " · " +
          info.tensor_count +
          " tensors · " +
          info.metadata_kv_count +
          " metadata"
      );
    } catch (error) {
      showError(error);
      setStatus("GGUF 检查失败");
    } finally {
      button.disabled = false;
    }
  }

  function renderModels() {
    const list = $("modelList");
    const count = $("modelCount");

    list.textContent = "";
    count.textContent = models.length + " 个模型文件";

    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent =
        "还没有模型索引。连接 Drive 后寻找 AI-Model-Vault，再扫描模型。";
      list.appendChild(empty);
      return;
    }

    for (const model of models) {
      const card = document.createElement("article");
      card.className = "model-card";

      if (
        runtimeState &&
        runtimeState.running &&
        runtimeState.model_relative_path === model.relativePath
      ) {
        card.classList.add("active");
      }

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
      probe.textContent = "Drive Range";
      probe.addEventListener("click", async () => {
        showError("");
        probe.disabled = true;
        try {
          await ensureAccessToken();
          const result = await window.DriveModelClient.probeRange(
            model,
            accessToken
          );
          setStatus("Drive Range 成功 · " + result.bytes + " bytes");
        } catch (error) {
          showError(error);
        } finally {
          probe.disabled = false;
        }
      });
      actions.appendChild(probe);

      if (model.runnableFormat === "gguf") {
        const inspect = document.createElement("button");
        inspect.type = "button";
        inspect.textContent = "本机检查";
        inspect.addEventListener("click", () => inspectModel(model, inspect));
        actions.appendChild(inspect);
      }

      const launch = document.createElement("button");
      launch.type = "button";
      launch.dataset.icon = "play";
      launch.textContent =
        model.runnableFormat === "gguf" ? "本机启动" : "暂不支持运行";
      launch.className =
        model.runnableFormat === "gguf" ? "primary" : "";
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
      await ensureAccessToken();

      let rootId = $("folderId").value.trim();
      if (!rootId) {
        const folder = await findPreferredFolder({ quiet: false });
        if (!folder) {
          throw new Error(
            "没有模型根文件夹 ID。请先寻找 AI-Model-Vault 或手动填写 folder ID。"
          );
        }
        rootId = folder.id;
      }

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

      window.DriveModelIndex.saveSnapshot(
        result.rootFolder,
        result.tree,
        true
      );

      models = window.DriveModelIndex.flattenModels(result.tree);
      renderModels();
      setDriveState(
        "已扫描 · " +
          result.rootFolder.name +
          " · " +
          result.scannedFolders +
          " 文件夹"
      );
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
    clearChat();

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
        throw new Error(
          data.error ||
            "Runtime 启动失败：" +
              response.status +
              "。请确认本机 Drive 根目录与网页选择的 Drive 文件夹一致。"
        );
      }

      setStatus(
        data.ready
          ? "本机模型已就绪 · PID " + data.pid
          : "本机模型正在加载 · PID " + data.pid
      );

      await refreshRuntime();
    } catch (error) {
      showError(error);
      setStatus("本机 Runtime 启动失败");
    }
  }

  async function stopModel() {
    showError("");
    saveRuntimeBase();
    clearRuntimePoll();

    try {
      const response = await fetch(runtimeUrl("/v1/models/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "停止失败");

      clearChat();
      setStatus("本机模型已停止");
      await refreshRuntime();
    } catch (error) {
      showError(error);
    }
  }

  async function init() {
    window.DriveModelClient.captureOAuthSession();
    await window.DriveModelClient.registerServiceWorker();

    $("folderName").value =
      localStorage.getItem("model_drive_root_name") ||
      window.MODEL_CONFIG.preferredFolderName ||
      "AI-Model-Vault";

    $("folderId").value =
      localStorage.getItem("model_drive_root_id") || "";

    runtimeBase =
      localStorage.getItem("model_runtime_base") ||
      window.MODEL_CONFIG.runtimeBase ||
      "http://127.0.0.1:8765";

    $("runtimeUrl").value = runtimeBase;

    const snapshot = window.DriveModelIndex.loadSnapshot();
    if (snapshot) {
      models = window.DriveModelIndex.flattenModels(snapshot.tree);
      renderModels();
      setDriveState(
        "已恢复上次索引 · " +
          (snapshot.rootFolder.name || snapshot.rootFolder.id)
      );
      setStatus("已恢复上次模型索引 · " + models.length + " 个文件");
    } else {
      renderModels();
    }

    renderChat();

    accessToken = await window.DriveModelClient.getAccessToken();
    $("loginBtn").textContent =
      accessToken ? "Drive 已连接" : "连接 Google Drive";

    if (accessToken) {
      await window.DriveModelClient.setServiceWorkerToken(accessToken);

      if (!$("folderId").value.trim()) {
        const found = await findPreferredFolder({
          quiet: true,
          autoScan: !snapshot
        });
        if (!found && !snapshot) {
          setDriveState(
            "Drive 已连接；未自动找到 AI-Model-Vault，可手动填写 folder ID。"
          );
        }
      } else if (!snapshot) {
        setDriveState("Drive 已连接 · 已保存模型根目录");
      }
    } else {
      setDriveState("尚未连接 Google Drive。");
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

  $("findVaultBtn").addEventListener("click", async () => {
    await findPreferredFolder({ quiet: false, autoScan: true });
  });

  $("scanBtn").addEventListener("click", scanDrive);

  $("runtimeCheckBtn").addEventListener("click", async () => {
    saveRuntimeBase();
    const ok = await refreshRuntime();
    setStatus(
      ok ? "本机 Runtime 已连接" : "无法连接本机 Runtime"
    );
  });

  $("stopBtn").addEventListener("click", stopModel);
  $("clearChatBtn").addEventListener("click", clearChat);

  $("chatForm").addEventListener("submit", event => {
    event.preventDefault();
    sendChat();
  });

  $("chatInput").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChat();
    }
  });

  init().catch(showError);
})();
