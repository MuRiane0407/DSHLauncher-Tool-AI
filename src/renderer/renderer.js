'use strict';

(function () {
  const api = window.api;

  const overlay = document.getElementById('overlay');
  const overlayText = document.getElementById('overlay-text');
  const statusEl = document.getElementById('status');
  const urlbar = document.getElementById('urlbar');

  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnExport = document.getElementById('btn-export');
  const btnExternal = document.getElementById('btn-external');
  const btnSettings = document.getElementById('btn-settings');
  const btnLog = document.getElementById('btn-log');
  const btnBack = document.getElementById('btn-back');
  const btnForward = document.getElementById('btn-forward');
  const btnReload = document.getElementById('btn-reload');

  const settingsModal = document.getElementById('settings-modal');
  const exportModal = document.getElementById('export-modal');
  const logPanel = document.getElementById('log-panel');
  const logBody = document.getElementById('log-body');

  let currentSettings = null;
  let currentResolved = null;
  let starting = false;
  let lastExportDest = null;
  let debugModeOn = false;
  let fpsTimer = null;
  let guestHidden = true; // 服务未就绪时隐藏底层 WebContentsView，显示遮罩

  // ---------- 工具函数 ----------
  function $(id) {
    return document.getElementById(id);
  }

  function val(id) {
    return $(id).value.trim();
  }

  function setVal(id, v) {
    $(id).value = v == null ? '' : String(v);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function appendLog(entry) {
    const div = document.createElement('div');
    div.className = 'log-line log-' + (entry.level || 'info');
    const t = new Date(entry.ts);
    const time = t.toLocaleTimeString('zh-CN', { hour12: false });
    div.textContent = '[' + time + '] ' + entry.message;
    logBody.appendChild(div);
    while (logBody.childElementCount > 500) logBody.removeChild(logBody.firstChild);
    logBody.scrollTop = logBody.scrollHeight;
  }

  // ---------- 状态 / overlay ----------
  function setStatus(state, text) {
    statusEl.className = 'status status-' + state;
    statusEl.textContent = '● ' + text;
  }

  function showOverlay(html) {
    overlayText.innerHTML = html;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  // 仅在显式需要时加载页面（初次加载 / 点击启动），不做“URL 不一致就重载”，
  // 避免 dsh 内部跳转/加 hash 后被反复强制跳回首页造成卡顿。
  function loadGuest(url) {
    api.guestLoad(url).catch(() => {});
  }

  // 把当前界面状态同步给主进程，用于摆放底层 WebContentsView（避开工具栏/日志/调试条/弹窗）
  function syncLayout() {
    const toolbarEl = document.getElementById('toolbar');
    const debugEl = document.getElementById('debug-panel');
    const modalOpen =
      !settingsModal.classList.contains('hidden') || !exportModal.classList.contains('hidden');
    const logOpen = !logPanel.classList.contains('hidden');
    api
      .layout({
        toolbarH: toolbarEl ? toolbarEl.offsetHeight : 52,
        debugH: debugModeOn ? (debugEl ? debugEl.offsetHeight : 28) : 0,
        logH: logOpen ? logPanel.offsetHeight : 0,
        modalOpen,
        guestHidden
      })
      .catch(() => {});
  }

  async function refreshStatus() {
    if (starting) return;
    try {
      const st = await api.status();
      if (st.up) {
        setStatus('up', '已连接 ' + st.url);
        hideOverlay();
        guestHidden = false;
      } else {
        setStatus('down', '未连接');
        showOverlay('服务未就绪。<br />点击「启动」启动容器并打开网页。');
        guestHidden = true;
      }
      if (debugModeOn) updateDebugInfo();
    } catch (_) {
      setStatus('down', '状态检测失败');
      guestHidden = true;
    }
    syncLayout();
  }

  // ---------- 调试模式 ----------
  function injectFpsCounter() {
    const code =
      "(function(){if(!window.__dshFps){window.__dshFps={frames:0,last:performance.now(),fps:0};" +
      "function l(t){var s=window.__dshFps;s.frames++;if(t-s.last>=1000){s.fps=Math.round(s.frames*1000/(t-s.last));s.frames=0;s.last=t;}requestAnimationFrame(l);}" +
      "requestAnimationFrame(l);}return true;})()";
    try {
      api.guestExec(code).catch(() => {});
    } catch (_) {
      /* 未就绪时忽略 */
    }
  }

  function colorizeFps(fps) {
    const el = $('dbg-fps');
    el.className = 'dbg-val ' + (fps >= 50 ? 'dbg-fps-good' : fps >= 30 ? 'dbg-fps-mid' : 'dbg-fps-bad');
    el.textContent = (typeof fps === 'number' ? fps : '--') + ' fps';
  }

  async function updateDebugInfo() {
    $('dbg-status').textContent = (statusEl.textContent || '').replace(/^●\s*/, '');
    try {
      const u = await api.guestGetUrl();
      $('dbg-url').textContent = u || '—';
    } catch (_) {
      $('dbg-url').textContent = '—';
    }
  }

  async function updateGpuInfo() {
    try {
      const g = await api.gpuStatus();
      const c = g.gpuCompositing;
      const label = c === 'enabled' ? '硬件加速' : c === 'unknown' ? '未知' : '软件渲染';
      const el = $('dbg-gpu');
      el.textContent = label;
      el.className = 'dbg-val ' + (c === 'enabled' ? 'dbg-fps-good' : 'dbg-fps-bad');
    } catch (_) {
      $('dbg-gpu').textContent = '?';
    }
  }

  function applyDebugMode(enabled) {
    debugModeOn = !!enabled;
    $('debug-panel').classList.toggle('hidden', !debugModeOn);
    if (fpsTimer) {
      clearInterval(fpsTimer);
      fpsTimer = null;
    }
    if (debugModeOn) {
      injectFpsCounter();
      updateDebugInfo();
      updateGpuInfo();
      fpsTimer = setInterval(async () => {
        try {
          const fps = await api.guestExec('window.__dshFps ? window.__dshFps.fps : 0');
          colorizeFps(fps);
        } catch (_) {
          /* ignore */
        }
      }, 1000);
    }
    syncLayout();
  }

  // ---------- 启动 / 停止 ----------
  async function onStart() {
    starting = true;
    setStatus('starting', '启动中…');
    showOverlay('正在启动容器与服务，请稍候…');
    guestHidden = true;
    syncLayout();
    btnStart.disabled = true;
    let res;
    try {
      res = await api.start();
    } finally {
      starting = false;
      btnStart.disabled = false;
    }
    if (res && res.ok) {
      if (res.url) loadGuest(res.url);
      await refreshStatus();
      if (res.warning) {
        appendLog({ ts: new Date().toISOString(), level: 'warn', message: res.warning });
      }
    } else if (res) {
      setStatus('down', '启动失败');
      showOverlay('启动失败：<br />' + escapeHtml(res.error || '未知错误'));
      appendLog({ ts: new Date().toISOString(), level: 'error', message: '启动失败: ' + res.error });
      syncLayout();
    }
  }

  async function onStop() {
    btnStop.disabled = true;
    try {
      const res = await api.stop();
      if (res.ok) {
        appendLog({ ts: new Date().toISOString(), level: 'info', message: '容器已停止' });
      } else if (res.error) {
        appendLog({ ts: new Date().toISOString(), level: 'error', message: '停止失败: ' + res.error });
      }
    } finally {
      btnStop.disabled = false;
      await refreshStatus();
    }
  }

  // ---------- 设置 ----------
  function collectSettings() {
    return {
      containerName: val('set-containerName'),
      port: parseInt(val('set-port'), 10) || 3080,
      url: val('set-url'),
      exportSource: val('set-exportSource'),
      exportCommand: val('set-exportCommand'),
      startCommand: val('set-startCommand'),
      webCommand: val('set-webCommand'),
      stopCommand: val('set-stopCommand'),
      healthCheckTimeoutMs: parseInt(val('set-timeout'), 10) || 60000,
      debugMode: $('set-debugMode').checked,
      hideSelectors: val('set-hideSelectors'),
      injectCss: val('set-injectCss'),
      autoStartDocker: $('set-autoStartDocker').checked,
      dockerDesktopPath: val('set-dockerDesktopPath')
    };
  }

  function populateSettingsForm(s) {
    setVal('set-containerName', s.containerName);
    setVal('set-port', s.port);
    setVal('set-url', s.url);
    setVal('set-exportSource', s.exportSource);
    setVal('set-exportCommand', s.exportCommand);
    setVal('set-startCommand', s.startCommand);
    setVal('set-webCommand', s.webCommand);
    setVal('set-stopCommand', s.stopCommand);
    setVal('set-timeout', s.healthCheckTimeoutMs);
    $('set-debugMode').checked = !!s.debugMode;
    setVal('set-hideSelectors', s.hideSelectors);
    setVal('set-injectCss', s.injectCss);
    $('set-autoStartDocker').checked = !!s.autoStartDocker;
    setVal('set-dockerDesktopPath', s.dockerDesktopPath);
  }

  async function updatePreview() {
    try {
      const resolved = await api.resolveCommands(collectSettings());
      const lines = [
        '启动容器： ' + resolved.startCommand,
        '启动 web： ' + resolved.webCommand,
        '停止容器： ' + resolved.stopCommand,
        '访问地址： ' + resolved.url,
        '导出命令： ' + resolved.exportCommand
      ];
      $('preview').textContent = lines.join('\n');
    } catch (_) {
      $('preview').textContent = '(预览失败)';
    }
  }

  function openSettings() {
    if (!currentSettings) return;
    populateSettingsForm(currentSettings);
    updatePreview();
    settingsModal.classList.remove('hidden');
    syncLayout();
  }

  async function saveSettings() {
    try {
      const res = await api.saveSettings(collectSettings());
      currentSettings = res.settings;
      currentResolved = res.resolved;
      settingsModal.classList.add('hidden');
      appendLog({ ts: new Date().toISOString(), level: 'info', message: '设置已保存' });
      urlbar.textContent = currentResolved.url;
      applyDebugMode(!!currentSettings.debugMode);
      await refreshStatus();
    } catch (e) {
      appendLog({ ts: new Date().toISOString(), level: 'error', message: '保存设置失败: ' + e.message });
    }
  }

  // ---------- 导出 ----------
  let browsePath = '/';
  let selectedSource = '';

  function joinPosix(a, b) {
    const base = a === '/' ? '' : a.replace(/\/+$/, '');
    return base + '/' + b;
  }

  function parentPosix(p) {
    let s = String(p || '/').replace(/\/+$/, '');
    if (s === '' || s === '/') return '/';
    const i = s.lastIndexOf('/');
    return i <= 0 ? '/' : s.slice(0, i);
  }

  function makeEntry(icon, name, isDir, onClick) {
    const el = document.createElement('div');
    el.className = 'dir-entry ' + (isDir ? 'dir' : 'file');
    const ic = document.createElement('span');
    ic.className = 'icon';
    ic.textContent = icon;
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = name;
    nm.title = name;
    el.appendChild(ic);
    el.appendChild(nm);
    if (onClick) el.addEventListener('click', onClick);
    return el;
  }

  function renderDirList(res) {
    const box = $('dir-list');
    box.textContent = '';
    if (!res.ok) {
      const empty = document.createElement('div');
      empty.className = 'dir-empty';
      empty.textContent = '无法读取目录：' + (res.error || '未知错误');
      box.appendChild(empty);
      $('dir-hint').textContent = '';
      return;
    }
    setVal('browse-path', res.dir);
    const dirs = res.dirs || [];
    const files = res.files || [];
    if (dirs.length === 0 && files.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dir-empty';
      empty.textContent = '（空目录）';
      box.appendChild(empty);
    }
    dirs.forEach((name) => {
      box.appendChild(makeEntry('📁', name, true, () => loadDir(joinPosix(res.dir, name))));
    });
    files.forEach((name) => {
      box.appendChild(makeEntry('📄', name, false));
    });
    $('dir-hint').textContent = dirs.length + ' 个文件夹 · ' + files.length + ' 个文件';
  }

  async function loadDir(p) {
    browsePath = String(p || '/');
    setVal('browse-path', browsePath);
    $('dir-hint').textContent = '加载中…';
    const res = await api.listDir(browsePath);
    renderDirList(res);
  }

  function openExport() {
    if (!currentSettings) return;
    selectedSource = currentSettings.exportSource || '/';
    setVal('export-source', selectedSource);
    setVal('export-dest', currentSettings.exportDest || lastExportDest || '');
    $('export-result').textContent = '';
    $('export-result').className = 'export-result';
    $('btn-open-export').disabled = true;
    exportModal.classList.remove('hidden');
    syncLayout();
    loadDir(selectedSource);
  }

  async function chooseDest() {
    const dir = await api.chooseDir();
    if (dir) setVal('export-dest', dir);
  }

  async function runExport() {
    const source = selectedSource || browsePath;
    const dest = val('export-dest');
    if (!dest) {
      $('export-result').textContent = '请先选择导出目录。';
      $('export-result').className = 'export-result err';
      return;
    }
    const resultEl = $('export-result');
    resultEl.textContent = '正在导出…';
    resultEl.className = 'export-result';
    $('btn-run-export').disabled = true;
    try {
      const res = await api.exportFiles({ source, dest });
      if (res.ok) {
        lastExportDest = res.dest;
        if (currentSettings) currentSettings.exportSource = res.source;
        resultEl.textContent = '导出成功 → ' + res.dest;
        resultEl.className = 'export-result ok';
        $('btn-open-export').disabled = false;
      } else if (res.canceled) {
        resultEl.textContent = '已取消。';
        resultEl.className = 'export-result';
      } else {
        resultEl.textContent = '导出失败：' + (res.error || '未知错误');
        resultEl.className = 'export-result err';
      }
    } finally {
      $('btn-run-export').disabled = false;
    }
  }

  async function openExportFolder() {
    const dest = val('export-dest');
    if (dest) await api.openFolder(dest);
  }

  // ---------- 事件绑定 ----------
  btnStart.addEventListener('click', onStart);
  btnStop.addEventListener('click', onStop);
  btnExport.addEventListener('click', openExport);
  btnExternal.addEventListener('click', () => api.openExternal().catch(() => {}));
  btnSettings.addEventListener('click', openSettings);

  btnLog.addEventListener('click', () => {
    logPanel.classList.toggle('hidden');
    syncLayout();
  });
  $('btn-clear-log').addEventListener('click', () => {
    logBody.textContent = '';
  });

  btnBack.addEventListener('click', () => api.guestBack().catch(() => {}));
  btnForward.addEventListener('click', () => api.guestForward().catch(() => {}));
  btnReload.addEventListener('click', () => api.guestReload().catch(() => {}));

  // 设置弹窗
  $('btn-save-settings').addEventListener('click', saveSettings);
  $('btn-cancel-settings').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    syncLayout();
  });
  ['set-containerName', 'set-port', 'set-url', 'set-exportSource', 'set-exportCommand', 'set-startCommand', 'set-webCommand', 'set-stopCommand'].forEach((id) => {
    $(id).addEventListener('input', debounce(updatePreview, 300));
  });

  // 导出弹窗
  $('btn-choose-dest').addEventListener('click', chooseDest);
  $('btn-run-export').addEventListener('click', runExport);
  $('btn-open-export').addEventListener('click', openExportFolder);
  $('btn-close-export').addEventListener('click', () => {
    exportModal.classList.add('hidden');
    syncLayout();
  });

  // 导出：容器内目录浏览器
  $('btn-up-dir').addEventListener('click', () => loadDir(parentPosix(browsePath)));
  $('btn-refresh-dir').addEventListener('click', () => loadDir(browsePath));
  $('btn-use-dir').addEventListener('click', () => {
    selectedSource = browsePath;
    setVal('export-source', selectedSource);
    appendLog({ ts: new Date().toISOString(), level: 'info', message: '导出源已设为: ' + selectedSource });
  });
  $('browse-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadDir(val('browse-path'));
  });

  // 底层 WebContentsView 的导航事件（由主进程转发）
  api.onGuestUrl((url) => {
    if (url) urlbar.textContent = url;
  });
  api.onGuestDomReady(() => {
    if (debugModeOn) {
      injectFpsCounter();
      updateDebugInfo();
    }
  });
  api.onGuestFail((data) => {
    appendLog({ ts: new Date().toISOString(), level: 'warn', message: '页面加载失败: ' + (data.errorDescription || data.errorCode || '') });
  });

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ---------- 初始化 ----------
  api.onLog(appendLog);

  async function init() {
    try {
      const res = await api.getSettings();
      currentSettings = res.settings;
      currentResolved = res.resolved;
      urlbar.textContent = currentResolved.url;
      applyDebugMode(!!currentSettings.debugMode);
      // 预加载页面，服务起来后即显示
      loadGuest(currentResolved.url);
      await refreshStatus();
    } catch (e) {
      showOverlay('初始化失败：' + escapeHtml(e.message));
    }
  }

  setInterval(refreshStatus, 10000);
  init();
})();
