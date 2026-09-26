(function () {
  "use strict";

  let accessToken = null;
  let models = [];
  let runtimeBase = "";
  let runtimeState = null;
  let backendState = null;
  let modelCapabilities = window.MODEL_CAPABILITIES || {};
  let runtimePollTimer = null;
  let runtimeReconnectTimer = null;
  let chatBusy = false;
  let chatHistory = [];
  let selectedVideoModel = null;
  let videoPollTimer = null;

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

  async function syncRuntimeDriveSession() {
    if (!accessToken) {
      await ensureAccessToken();
    }
    const response = await fetch(runtimeUrl("/v1/drive/session"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "无法把 Drive 会话同步到本机 Runtime。");
    }
    return true;
  }

  function clearRuntimePoll() {
    if (runtimePollTimer) {
      clearTimeout(runtimePollTimer);
      runtimePollTimer = null;
    }
  }

  function clearRuntimeReconnect() {
    if (runtimeReconnectTimer) {
      clearTimeout(runtimeReconnectTimer);
      runtimeReconnectTimer = null;
    }
  }

  function scheduleRuntimeReconnect(delay = 3000) {
    clearRuntimeReconnect();
    runtimeReconnectTimer = setTimeout(async () => {
      const ok = await refreshRuntime();
      if (!ok) scheduleRuntimeReconnect(Math.min(delay + 1000, 10000));
    }, delay);
  }

  function setRuntimeInstalledState(connected) {
    const install = $("installRuntimeBtn");
    const hint = $("runtimeHint");
    if (install) install.hidden = connected;
    if (hint) {
      hint.textContent = connected
        ? "本机 AI 引擎已自动连接。以后直接打开这个网页即可。"
        : "未检测到本机 AI 引擎。首次安装一次后，以后只需要打开网页。";
    }
  }

  function scheduleRuntimeRefresh() {
    clearRuntimePoll();
    if (
      runtimeState &&
      (runtimeState.phase === "loading" || runtimeState.phase === "downloading")
    ) {
      runtimePollTimer = setTimeout(() => {
        refreshRuntime().catch(() => {});
      }, 1000);
    }
  }

  function runtimeLabel(state) {
    if (!state) return "未连接本地 Runtime";
    if (state.phase === "downloading") {
      const pct =
        typeof state.download_progress === "number"
          ? Math.floor(state.download_progress * 100)
          : null;
      return (
        "Drive 下载中 · " +
        (state.model || "GGUF") +
        (pct === null ? "" : " · " + pct + "%")
      );
    }
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
    if (!runtimeState) return;
    if (runtimeState.drive_api_session) {
      setDriveState("Drive API 已连接 · Runtime 使用本机缓存，不需要 Google Drive 桌面版。");
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
      try {
        const backendResponse = await fetch(runtimeUrl("/v1/backends"), { cache: "no-store" });
        backendState = backendResponse.ok ? await backendResponse.json() : null;
      } catch (_) {
        backendState = null;
      }
      await loadModelCapabilities();
      if (accessToken) {
        try {
          await syncRuntimeDriveSession();
          runtimeState.drive_api_session = true;
        } catch (_) {}
      }
      clearRuntimeReconnect();
      setRuntimeInstalledState(true);
      $("runtimeState").textContent = runtimeLabel(runtimeState);
      $("runtimeLog").textContent = runtimeLogText(runtimeState);
      $("stopBtn").disabled = !runtimeState.running;
      updateDriveRuntimeCompatibility();
      updateChatAvailability();
      renderModels();
      if (
        runtimeState.video &&
        !$("videoWorkspace").hidden &&
        runtimeState.video.running
      ) {
        setVideoStatus(
          videoPhaseText(runtimeState.video),
          runtimeState.video.download_progress
        );
      }
      scheduleRuntimeRefresh();
      return true;
    } catch (_) {
      runtimeState = null;
      backendState = null;
      $("runtimeState").textContent = "未检测到本机 AI 引擎";
      $("runtimeLog").textContent =
        "网页会持续自动重连。若这是第一次使用，请先安装一次 Model Runtime。";
      $("stopBtn").disabled = true;
      setRuntimeInstalledState(false);
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
      await syncRuntimeDriveSession();
      const response = await fetch(runtimeUrl("/v1/models/inspect"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drive_file_id: model.representativeFile && model.representativeFile.id,
          file_name: model.representativeFile && model.representativeFile.name,
          size: Number(model.representativeFile && model.representativeFile.size || 0),
          md5_checksum: model.representativeFile && model.representativeFile.md5Checksum,
          resource_key: model.representativeFile && model.representativeFile.resourceKey,
          relative_path: model.relativePath
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.error ||
            "本机缓存中还没有这个模型。先点“本机启动”，Runtime 会直接从 Google Drive API 下载并缓存。"
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

  function backendInfo(model) {
    const map = backendState && backendState.backends ? backendState.backends : {};
    return map[model.backend] || null;
  }

  function videoAdapterFor(model) {
    if (!model) return null;
    const hay = [
      model.id,
      model.name,
      model.repo,
      model.packagePath,
      model.relativePath
    ].filter(Boolean).join(" ").toLowerCase();

    if (
      hay.includes("wan2.2-ti2v-5b") ||
      hay.includes("wan2.2 ti2v 5b")
    ) {
      return {
        id: "wan2.2-ti2v-5b",
        width: 832,
        height: 480,
        frames: 49,
        fps: 24,
        steps: 20,
        cfg: 5
      };
    }

    if (
      hay.includes("hunyuanvideo-1.5") ||
      hay.includes("hunyuanvideo 1.5")
    ) {
      return {
        id: "hunyuanvideo-1.5",
        width: 1280,
        height: 720,
        frames: 49,
        fps: 24,
        steps: 20,
        cfg: 6,
        lockResolution: true
      };
    }

    return null;
  }

  function stopVideoPolling() {
    if (videoPollTimer) {
      clearTimeout(videoPollTimer);
      videoPollTimer = null;
    }
  }

  function setVideoStatus(text, progress = null) {
    $("videoStatus").textContent = text;
    const bar = $("videoProgressBar");
    if (typeof progress === "number" && Number.isFinite(progress)) {
      bar.style.width = Math.max(0, Math.min(100, progress * 100)) + "%";
    } else {
      bar.style.width = "0%";
    }
  }

  function openVideoWorkspace(model) {
    const adapter = videoAdapterFor(model);
    if (!adapter) {
      showError("这个视频模型还没有网页自动运行适配器。");
      return;
    }

    selectedVideoModel = model;
    $("videoWorkspace").hidden = false;
    $("videoModelLabel").textContent =
      model.name + " · " + adapter.id + " · ComfyUI";
    $("videoWidth").value = adapter.width;
    $("videoHeight").value = adapter.height;
    $("videoWidth").disabled = !!adapter.lockResolution;
    $("videoHeight").disabled = !!adapter.lockResolution;
    $("videoFrames").value = adapter.frames;
    $("videoFps").value = adapter.fps;
    $("videoSteps").value = adapter.steps;
    $("videoCfg").value = adapter.cfg;
    $("videoSeed").value = "";
    $("videoResult").hidden = true;
    $("videoResult").removeAttribute("src");
    $("videoEmpty").hidden = false;
    $("videoGenerateBtn").disabled = false;
    $("videoStopBtn").disabled = true;
    setVideoStatus(
      "已选择 " + model.name + "。填写提示词后点击“生成视频”。"
    );
    $("videoWorkspace").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeVideoWorkspace() {
    stopVideoPolling();
    selectedVideoModel = null;
    $("videoWorkspace").hidden = true;
  }

  function videoPhaseText(state) {
    const phase = String(state && state.phase || "idle");
    const detail = String(state && state.detail || "");
    const labels = {
      idle: "等待任务",
      starting: "正在准备视频任务",
      preparing_comfyui: "首次使用：正在下载 ComfyUI",
      extracting_comfyui: "正在解压 ComfyUI",
      starting_comfyui: "正在启动 ComfyUI",
      downloading_models: "正在准备视频后端模型",
      building_workflow: "正在构建工作流",
      queued: "任务已提交，等待生成",
      generating: "正在生成视频",
      complete: "视频生成完成",
      failed: "视频任务失败",
      cancelled: "视频任务已取消"
    };
    return (labels[phase] || phase) + (detail ? " · " + detail : "");
  }

  async function pollVideoStatus() {
    stopVideoPolling();
    try {
      const response = await fetch(runtimeUrl("/v1/video/status"), {
        cache: "no-store"
      });
      const state = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(state.error || "无法读取视频任务状态。");
      }

      let progress =
        typeof state.download_progress === "number"
          ? state.download_progress
          : null;
      let text = videoPhaseText(state);

      if (state.current_file) {
        text += " · " + state.current_file;
      }
      if (
        state.downloaded_bytes &&
        state.download_total_bytes &&
        state.download_total_bytes > 0
      ) {
        text +=
          " · " +
          formatBytes(state.downloaded_bytes) +
          " / " +
          formatBytes(state.download_total_bytes);
      }

      setVideoStatus(text, progress);
      $("videoStopBtn").disabled = !state.running;
      $("videoGenerateBtn").disabled = !!state.running;

      if (state.phase === "complete" && state.job_id) {
        const video = $("videoResult");
        video.src =
          runtimeUrl("/v1/video/file?job_id=") +
          encodeURIComponent(state.job_id) +
          "&t=" +
          Date.now();
        video.hidden = false;
        $("videoEmpty").hidden = true;
        video.load();
        setStatus("视频生成完成 · " + (state.model || "Video"));
        return;
      }

      if (state.phase === "failed") {
        const message =
          state.error ||
          "视频生成失败。请展开高级诊断查看 Runtime 日志。";
        showError(message);
        setVideoStatus("视频任务失败 · " + message);
        $("videoGenerateBtn").disabled = false;
        $("videoStopBtn").disabled = true;
        return;
      }

      if (state.phase === "cancelled") {
        $("videoGenerateBtn").disabled = false;
        return;
      }

      if (state.running) {
        videoPollTimer = setTimeout(pollVideoStatus, 1500);
      }
    } catch (error) {
      showError(error);
      $("videoGenerateBtn").disabled = false;
    }
  }

  async function generateVideo() {
    if (!selectedVideoModel) {
      showError("请先从模型库选择一个已适配的视频模型。");
      return;
    }

    if (!runtimeState || Number(runtimeState.runtime_version || 0) < 9) {
      showError(
        "当前本机 AI 引擎版本不支持网页视频生成。请安装 Model Runtime v0.9 后重试。"
      );
      return;
    }

    const prompt = $("videoPrompt").value.trim();
    if (!prompt) {
      showError("请先填写视频提示词。");
      $("videoPrompt").focus();
      return;
    }

    const seedText = $("videoSeed").value.trim();
    const adapter = videoAdapterFor(selectedVideoModel);
    if (
      adapter &&
      adapter.lockResolution &&
      (Number($("videoWidth").value) !== adapter.width ||
        Number($("videoHeight").value) !== adapter.height)
    ) {
      $("videoWidth").value = adapter.width;
      $("videoHeight").value = adapter.height;
      showError(
        selectedVideoModel.name +
          " 当前使用固定 " +
          adapter.width +
          "×" +
          adapter.height +
          " 的官方工作流。"
      );
      return;
    }

    const payload = {
      model_id: selectedVideoModel.id,
      name: selectedVideoModel.name,
      package_path:
        selectedVideoModel.packagePath || selectedVideoModel.relativePath,
      prompt,
      negative_prompt: $("videoNegative").value.trim(),
      width: Number($("videoWidth").value),
      height: Number($("videoHeight").value),
      frames: Number($("videoFrames").value),
      fps: Number($("videoFps").value),
      steps: Number($("videoSteps").value),
      cfg: Number($("videoCfg").value)
    };
    if (seedText) payload.seed = Number(seedText);

    showError("");
    $("videoGenerateBtn").disabled = true;
    $("videoStopBtn").disabled = false;
    $("videoResult").hidden = true;
    $("videoEmpty").hidden = false;
    setVideoStatus("正在提交视频任务…");
    setStatus("正在启动 " + selectedVideoModel.name + " 视频工作流…");

    try {
      const response = await fetch(runtimeUrl("/v1/video/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "视频任务启动失败：" + response.status);
      }
      await pollVideoStatus();
    } catch (error) {
      showError(error);
      $("videoGenerateBtn").disabled = false;
      $("videoStopBtn").disabled = true;
      setVideoStatus("视频任务启动失败。");
    }
  }

  async function stopVideo() {
    stopVideoPolling();
    try {
      const response = await fetch(runtimeUrl("/v1/video/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "停止视频任务失败。");
      $("videoGenerateBtn").disabled = false;
      $("videoStopBtn").disabled = true;
      setVideoStatus(videoPhaseText(data.video || {}));
    } catch (error) {
      showError(error);
    }
  }

  async function loadModelCapabilities() {
    try {
      const response = await fetch(runtimeUrl("/v1/models/capabilities"), { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      modelCapabilities = Object.assign({}, modelCapabilities, Object.fromEntries((data.models || []).map(item => [item.model_id, item])));
    } catch (_) {
      modelCapabilities = window.MODEL_CAPABILITIES || {};
    }
  }

  function capabilityInfo(model) {
    return modelCapabilities[String(model.id || "").toLowerCase()] || null;
  }

  function planText(plan) {
    const status = plan.backend_status || {};
    const requirements = Array.isArray(plan.requirements)
      ? plan.requirements.join(" · ")
      : "";
    return [
      "后端：" + (plan.backend || "未知"),
      "工作区：" + (plan.workspace || "generic"),
      "本机检测：" + (status.detected ? "已检测到" : "未检测到"),
      status.detail ? "状态：" + status.detail : "",
      plan.availability_label ? "模型状态：" + plan.availability_label : "",
      plan.adapter ? "适配器：" + plan.adapter : "",
      plan.availability_reason ? "说明：" + plan.availability_reason : "",
      plan.local_error ? "本机路径：" + plan.local_error : "",
      requirements ? "需要：" + requirements : "",
      plan.note || ""
    ].filter(Boolean).join("\n");
  }

  async function planModel(model, button) {
    showError("");
    saveRuntimeBase();
    button.disabled = true;
    setStatus("正在分析 " + model.name + " 的运行方案…");

    try {
      const response = await fetch(runtimeUrl("/v1/models/plan"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backend: model.backend,
          category: model.category,
          package_path: model.packagePath || model.relativePath,
          relative_path: model.relativePath,
          name: model.name,
          model_id: model.id
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "运行方案分析失败：" + response.status);

      const plan = data.plan || {};
      $("runtimeLog").textContent = planText(plan);
      setStatus(
        model.name +
          " · " +
          model.backend +
          (plan.backend_status && plan.backend_status.detected
            ? " 后端已检测"
            : " 需要准备后端")
      );
    } catch (error) {
      showError(error);
      setStatus("运行方案分析失败");
    } finally {
      button.disabled = false;
    }
  }

  function renderModels() {
    const list = $("modelList");
    const count = $("modelCount");

    list.textContent = "";
    count.textContent = models.length + " 个模型包";

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
      format.textContent = model.backend || extension(model.representativeFile && model.representativeFile.name);

      const title = document.createElement("div");
      title.className = "model-title";
      title.textContent = model.name;

      titleWrap.append(format, title);

      const size = document.createElement("div");
      size.className = "model-size";
      size.textContent =
        formatBytes(model.totalSize) +
        " · " +
        model.fileCount +
        " 文件";

      head.append(titleWrap, size);

      const meta = document.createElement("div");
      meta.className = "model-meta";
      const info = backendInfo(model);
      const videoAdapter = videoAdapterFor(model);
      const capability = capabilityInfo(model);
      const pieces = [
        model.category || "unknown",
        model.workspace || "generic",
        model.qualityTier || "",
        capability ? capability.label : "",
        videoAdapter ? "网页视频适配已支持" : "",
        videoAdapter
          ? "首次运行自动准备"
          : info
            ? (info.detected ? "后端已检测" : "后端未安装")
            : ""
      ].filter(Boolean);
      meta.textContent = pieces.join(" · ");

      const path = document.createElement("div");
      path.className = "model-path";
      path.textContent = model.packagePath || model.relativePath;

      const actions = document.createElement("div");
      actions.className = "model-actions";

      const representative = model.representativeFile;
      if (representative && representative.id && Number(representative.size || 0)) {
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
              representative,
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
      }

      const plan = document.createElement("button");
      plan.type = "button";
      plan.textContent = "运行方案";
      plan.addEventListener("click", () => planModel(model, plan));
      actions.appendChild(plan);

      if (model.directLaunch) {
        const inspect = document.createElement("button");
        inspect.type = "button";
        inspect.textContent = "本机检查";
        inspect.addEventListener("click", () => inspectModel(model, inspect));
        actions.appendChild(inspect);

        const launch = document.createElement("button");
        launch.type = "button";
        launch.dataset.icon = "play";
        launch.textContent = "使用模型";
        launch.className = "primary";
        launch.addEventListener("click", () => startModel(model));
        actions.appendChild(launch);
      } else if (videoAdapter) {
        const useVideo = document.createElement("button");
        useVideo.type = "button";
        useVideo.dataset.icon = "play";
        useVideo.textContent = "使用视频模型";
        useVideo.className = "primary";
        useVideo.addEventListener("click", () => openVideoWorkspace(model));
        actions.appendChild(useVideo);
      } else {
        const prepare = document.createElement("button");
        prepare.type = "button";
        prepare.dataset.icon = "play";
        prepare.textContent = "准备 " + (model.backend || "后端");
        prepare.className = "primary";
        prepare.addEventListener("click", () => planModel(model, prepare));
        actions.appendChild(prepare);
      }

      card.append(head, meta, path, actions);
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

      const registry = await window.DriveModelClient.loadModelRegistry(
        accessToken,
        rootId
      );

      window.DriveModelIndex.saveSnapshot(
        result.rootFolder,
        result.tree,
        registry,
        true
      );

      models = window.DriveModelIndex.flattenPackages(
        result.tree,
        registry
      );
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
          " 权重文件 · " +
          models.length +
          " 模型包"
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
      await syncRuntimeDriveSession();
      const response = await fetch(runtimeUrl("/v1/models/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drive_file_id: model.representativeFile && model.representativeFile.id,
          file_name: model.representativeFile && model.representativeFile.name,
          display_name: model.name,
          name: model.name,
          relative_path: model.relativePath,
          size: Number(model.representativeFile && model.representativeFile.size || 0),
          md5_checksum: model.representativeFile && model.representativeFile.md5Checksum,
          resource_key: model.representativeFile && model.representativeFile.resourceKey,
          format: model.runnableFormat,
          backend: model.backend,
          category: model.category
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.error ||
            "模型启动失败：" +
              response.status +
              "。请确认本机 AI 引擎已连接，并重新连接 Google Drive 后再试。"
        );
      }

      setStatus(
        data.phase === "downloading"
          ? "正在从 Google Drive 下载到本机缓存…"
          : data.ready
            ? "本机模型已就绪"
            : "本机模型正在加载"
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
      models = window.DriveModelIndex.flattenPackages(
        snapshot.tree,
        snapshot.registry || null
      );
      renderModels();
      setDriveState(
        "已恢复上次索引 · " +
          (snapshot.rootFolder.name || snapshot.rootFolder.id)
      );
      setStatus("已恢复上次模型索引 · " + models.length + " 个模型包");
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
      setDriveState("尚未连接 Google Drive。连接后模型由 Drive API 读取，不需要桌面版。");
    }

    const runtimeOk = await refreshRuntime();
    if (!runtimeOk) scheduleRuntimeReconnect();
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

  $("installRuntimeBtn").addEventListener("click", () => {
    window.open(
      "https://github.com/Jvust2/Model#one-time-windows-install",
      "_blank",
      "noopener,noreferrer"
    );
  });

  $("videoGenerateBtn").addEventListener("click", generateVideo);
  $("videoStopBtn").addEventListener("click", stopVideo);
  $("videoCloseBtn").addEventListener("click", closeVideoWorkspace);

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
