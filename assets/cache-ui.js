(() => {
  "use strict";

  const panel = document.querySelector(".runtime-panel");
  if (!panel) return;

  const style = document.createElement("style");
  style.textContent = `
    .cache-manager { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
    .cache-manager-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .cache-manager-title { color: var(--text); font-size: 12px; font-weight: 650; }
    .cache-manager-note { margin-top: 5px; color: var(--muted); font-size: 10px; }
    .cache-manager-actions { display: flex; gap: 7px; flex-wrap: wrap; }
    .cache-manager-actions button { min-height: 34px; padding: 6px 10px; font-size: 10px; }
    .cache-list { display: grid; gap: 7px; margin-top: 10px; }
    .cache-entry { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; background: #090e1770; }
    .cache-entry-name { min-width: 0; color: var(--blue); font-size: 10px; overflow-wrap: anywhere; }
    .cache-entry-meta { margin-top: 2px; color: var(--muted); font-size: 9px; }
    .cache-entry button { flex: 0 0 auto; min-height: 30px; padding: 5px 9px; font-size: 9px; }
    .cache-empty { color: var(--muted); font-size: 10px; padding: 8px 0; }
  `;
  document.head.appendChild(style);

  const manager = document.createElement("div");
  manager.className = "cache-manager";
  manager.innerHTML = `
    <div class="cache-manager-head">
      <div>
        <div class="cache-manager-title">Drive 模型缓存</div>
        <div class="cache-manager-note">模型按需启动时下载，默认永久保留；只有点击删除才会清理。</div>
      </div>
      <div class="cache-manager-actions">
        <button id="refreshCacheBtn" type="button">刷新</button>
        <button id="clearAllCacheBtn" type="button">清空全部</button>
      </div>
    </div>
    <div id="cacheList" class="cache-list"><div class="cache-empty">正在读取缓存列表…</div></div>
  `;
  const advanced = panel.querySelector(".runtime-advanced");
  panel.insertBefore(manager, advanced || null);

  const list = manager.querySelector("#cacheList");
  const refresh = manager.querySelector("#refreshCacheBtn");
  const clearAll = manager.querySelector("#clearAllCacheBtn");

  function baseUrl() {
    const input = document.querySelector("#runtimeUrl");
    const value = (input && input.value.trim()) ||
      localStorage.getItem("model_runtime_base") ||
      (window.MODEL_CONFIG && window.MODEL_CONFIG.runtimeBase) ||
      "http://127.0.0.1:8765";
    return value.replace(/\/$/, "");
  }

  function bytes(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return "大小未知";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = n;
    let i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i += 1; }
    return size.toFixed(i >= 3 ? 2 : 1) + " " + units[i];
  }

  function render(entries) {
    list.textContent = "";
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "cache-empty";
      empty.textContent = "没有已完成的模型缓存。";
      list.appendChild(empty);
      return;
    }
    entries.forEach(entry => {
      const row = document.createElement("div");
      row.className = "cache-entry";
      const info = document.createElement("div");
      info.style.minWidth = "0";
      const name = document.createElement("div");
      name.className = "cache-entry-name";
      name.textContent = entry.name || entry.file_id;
      const meta = document.createElement("div");
      meta.className = "cache-entry-meta";
      meta.textContent = (entry.cached ? bytes(entry.size) : "未完成") + " · " + entry.file_id;
      info.append(name, meta);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "删除";
      button.addEventListener("click", async () => {
        if (!window.confirm("删除“" + (entry.name || entry.file_id) + "”的本地缓存？")) return;
        button.disabled = true;
        try {
          const response = await fetch(baseUrl() + "/v1/models/cache/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ drive_file_id: entry.file_id })
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || "删除缓存失败");
          await load();
        } catch (error) {
          window.alert(error.message || String(error));
          button.disabled = false;
        }
      });
      row.append(info, button);
      list.appendChild(row);
    });
  }

  async function load() {
    refresh.disabled = true;
    try {
      const response = await fetch(baseUrl() + "/v1/models/cache", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Runtime 未连接");
      render(Array.isArray(data.entries) ? data.entries : []);
    } catch (_) {
      list.textContent = "";
      const empty = document.createElement("div");
      empty.className = "cache-empty";
      empty.textContent = "Runtime 未连接，连接后会显示本地缓存。";
      list.appendChild(empty);
    } finally {
      refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", load);
  clearAll.addEventListener("click", async () => {
    if (!window.confirm("删除所有本地模型缓存？此操作不会删除 Drive 中的模型。")) return;
    clearAll.disabled = true;
    try {
      const response = await fetch(baseUrl() + "/v1/models/cache/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "清空缓存失败");
      await load();
    } catch (error) {
      window.alert(error.message || String(error));
    } finally {
      clearAll.disabled = false;
    }
  });

  const check = document.querySelector("#runtimeCheckBtn");
  if (check) check.addEventListener("click", () => setTimeout(load, 300));
  load();
})();