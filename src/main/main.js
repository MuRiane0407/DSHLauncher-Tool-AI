'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const settingsStore = require('./settings');
const docker = require('./docker');

// 性能：避免 Electron 因 GPU 黑名单回退到软件渲染（软件渲染会明显比浏览器卡）
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
// 修复 Windows 上被误判为“窗口被遮挡/后台”而把渲染节流到 30fps 的问题
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow = null;
let guestView = null;
let cssKey = null; // 注入的页面样式表 key，用于替换时移除旧样式
// 界面布局状态（由渲染进程测量并同步），用于给底层 WebContentsView 让位
let uiState = {
  toolbarH: 52,
  debugH: 0,
  logH: 0,
  modalOpen: false,
  guestHidden: true
};

// 窗口图标（打包后 Windows 会用 exe 内嵌图标，这里主要供开发模式 / Linux 显示）
const iconPath = path.join(__dirname, '..', '..', 'build', 'icon.png');
const windowIcon = fs.existsSync(iconPath) ? iconPath : undefined;

function log(level, message) {
  const entry = { ts: new Date().toISOString(), level, message: String(message) };
  console.log(`[${entry.level}] ${entry.message}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', entry);
  }
}

/** 把 docker 命令的常见错误翻译成人话。 */
function describeDockerError(stderr) {
  const s = String(stderr || '');
  if (/not found|command not found|is not recognized/i.test(s)) {
    return '未找到 docker 命令。请确认已安装 Docker 并加入 PATH（或环境变量），或在「设置」中修正命令模板。';
  }
  if (/permission denied/i.test(s)) {
    return 'docker 权限不足。Linux 下请把当前用户加入 docker 组（sudo usermod -aG docker $USER 后重新登录）。';
  }
  if (/no such container/i.test(s)) {
    return '容器不存在，请检查「设置」中的容器名是否与 docker ps -a 一致。';
  }
  if (/is not running/i.test(s)) {
    return '容器未运行，请先点「启动」。';
  }
  if (/cannot connect to the docker daemon/i.test(s)) {
    return '无法连接 Docker 守护进程，请确认 Docker 已启动。';
  }
  if (/no such file or directory/i.test(s)) {
    return '路径不存在：' + s.trim();
  }
  return s;
}

/** 规范化容器内的 POSIX 路径（去重复斜杠、去末尾斜杠、确保以 / 开头）。 */
function normalizeContainerPath(p) {
  let s = String(p == null ? '/' : p).replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  if (!s.startsWith('/')) s = '/' + s;
  return s || '/';
}

/** 返回容器内某路径的父目录。 */
function parentPath(p) {
  const s = normalizeContainerPath(p);
  if (s === '/') return '/';
  const i = s.lastIndexOf('/');
  return i <= 0 ? '/' : s.slice(0, i);
}

function layoutGuest() {
  if (!mainWindow || !guestView) return;
  const [w, h] = mainWindow.getContentSize();
  const top = uiState.toolbarH + uiState.debugH;
  const bottom = uiState.logH;
  guestView.setVisible(!uiState.modalOpen && !uiState.guestHidden);
  guestView.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top - bottom) });
}

// 按设置注入页面 CSS：hideSelectors 隐藏元素 + injectCss 自定义覆盖（例如去掉装饰层阴影）
async function applyCustomCss() {
  if (!guestView) {
    log('warn', '注入 CSS 失败：guest 视图尚未创建');
    return;
  }
  try {
    if (cssKey != null) {
      await guestView.webContents.removeInsertedCSS(cssKey);
      cssKey = null;
    }
  } catch (_) {
    /* ignore */
  }
  const s = settingsStore.load();
  const parts = [];
  const raw = (s.hideSelectors || '').trim();
  if (raw) {
    parts.push(
      raw
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => x + '{display:none !important;}')
        .join('')
    );
  }
  const inject = (s.injectCss || '').trim();
  if (inject) parts.push(inject);
  const css = parts.join('\n');
  if (!css) {
    log('info', '未配置自定义 CSS（hideSelectors / injectCss 均为空）');
    return;
  }
  try {
    cssKey = await guestView.webContents.insertCSS(css);
    log('info', `已向页面注入 CSS（${css.length} 字符）`);
  } catch (err) {
    log('error', `注入 CSS 失败: ${err && err.message ? err.message : err}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'DSH Launcher',
    autoHideMenuBar: true,
    backgroundColor: '#14161a',
    icon: windowIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // 底层浏览器视图：直接加载 dsh 页面（与窗口同层合成，比 <webview> 更流畅）
  guestView = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.contentView.addChildView(guestView);
  layoutGuest();

  mainWindow.on('resize', layoutGuest);

  // 转发 guest 的导航/加载事件给渲染进程
  guestView.webContents.on('did-navigate', (_e, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('guest:url', url);
  });
  guestView.webContents.on('did-navigate-in-page', (_e, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('guest:url', url);
  });
  guestView.webContents.on('dom-ready', () => {
    applyCustomCss();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('guest:dom-ready');
  });
  guestView.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    if (errorCode === -3) return; // ABORTED，忽略
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('guest:fail', { errorCode, errorDescription });
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
    guestView = null;
  });
}

const externalWindows = [];

// 实验：用普通 BrowserWindow 打开 dsh 页面，并在标题栏实时显示 FPS
function openExternalWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'DSH 新窗口',
    autoHideMenuBar: true,
    backgroundColor: '#14161a',
    icon: windowIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadURL(url).catch(() => {});

  const fpsCode =
    "(function(){if(!window.__dshFps){window.__dshFps={frames:0,last:performance.now(),fps:0};" +
    "function l(t){var s=window.__dshFps;s.frames++;if(t-s.last>=1000){s.fps=Math.round(s.frames*1000/(t-s.last));s.frames=0;s.last=t;}requestAnimationFrame(l);}" +
    "requestAnimationFrame(l);}return true;})()";
  let timer = null;
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(fpsCode).catch(() => {});
    if (timer) clearInterval(timer);
    timer = setInterval(async () => {
      try {
        const fps = await win.webContents.executeJavaScript('window.__dshFps ? window.__dshFps.fps : 0');
        win.setTitle('DSH 新窗口 · ' + fps + ' FPS');
      } catch (_) {
        /* ignore */
      }
    }, 1000);
  });
  win.on('closed', () => {
    if (timer) clearInterval(timer);
    const i = externalWindows.indexOf(win);
    if (i >= 0) externalWindows.splice(i, 1);
  });
  externalWindows.push(win);
  return true;
}

function registerIpc() {
  ipcMain.handle('settings:get', () => {
    const settings = settingsStore.load();
    return { settings, resolved: settingsStore.resolve(settings) };
  });

  ipcMain.handle('settings:save', (_e, s) => {
    const settings = settingsStore.save(s);
    log('info', '设置已保存');
    applyCustomCss();
    return { settings, resolved: settingsStore.resolve(settings) };
  });

  ipcMain.handle('settings:resolve', (_e, s) => {
    return settingsStore.resolve({ ...settingsStore.load(), ...(s || {}) });
  });

  ipcMain.handle('docker:start', async () => {
    const settings = settingsStore.load();
    const cmds = settingsStore.resolve(settings);
    try {
      // 0) 确保 Docker 引擎就绪（Windows 下若 Docker Desktop 未运行则尝试拉起）
      if (settings.autoStartDocker !== false) {
        if (!(await docker.daemonUp())) {
          log('info', 'Docker 引擎未运行，尝试启动 Docker Desktop…');
          if (docker.launchDockerDesktop(settings.dockerDesktopPath)) {
            log('info', '已请求启动 Docker Desktop，等待引擎就绪（最长 90 秒）…');
            const ready = await docker.waitForDaemon(90000, () => log('info', '等待 Docker 引擎就绪…'));
            if (!ready) {
              const msg = 'Docker 引擎启动超时，请手动启动 Docker Desktop 后重试。';
              log('error', msg);
              return { ok: false, error: msg };
            }
            log('info', 'Docker 引擎已就绪');
          } else {
            log('warn', `未找到 Docker Desktop（${settings.dockerDesktopPath || '未配置路径'}），请手动启动，或在「设置」中修正路径。`);
          }
        }
      }

      // 1) 已经在运行就直接返回
      if (await docker.httpGet(cmds.url, 3000)) {
        log('info', `服务已在运行: ${cmds.url}`);
        return { ok: true, alreadyRunning: true, url: cmds.url };
      }

      // 2) 启动容器（容器已在运行时会直接返回成功，若失败则记录但不中断）
      log('info', `执行: ${cmds.startCommand}`);
      try {
        const startRes = await docker.run(cmds.startCommand, { timeoutMs: 120000 });
        if (startRes.code !== 0) {
          log('warn', `容器启动命令返回退出码 ${startRes.code}，继续尝试…\n${startRes.stderr || startRes.stdout}`);
        } else {
          log('info', '容器已启动');
        }
      } catch (err) {
        log('warn', `容器启动命令执行异常: ${err.message}`);
      }

      // 3) 启动容器内的 web 服务（默认命令带 -d，立即返回）
      log('info', `执行: ${cmds.webCommand}`);
      const webRes = await docker.run(cmds.webCommand, { timeoutMs: 30000 });
      if (webRes.code !== 0) {
        const msg = describeDockerError(webRes.stderr || webRes.stdout);
        log('error', `启动 web 服务失败:\n${msg}`);
        return { ok: false, error: msg };
      }
      log('info', '已发送 web 启动命令，等待服务就绪…');

      // 4) 等待 URL 可访问
      const up = await docker.waitForUrl(
        cmds.url,
        settings.healthCheckTimeoutMs || 60000,
        () => log('info', '等待服务就绪…')
      );
      if (up) {
        log('info', `服务已就绪: ${cmds.url}`);
        return { ok: true, url: cmds.url };
      }
      log('warn', `等待超时：${cmds.url} 尚未就绪`);
      return { ok: true, url: cmds.url, warning: '服务可能仍在启动中，稍后可点击「刷新」。' };
    } catch (err) {
      const msg = describeDockerError(err.message);
      log('error', `启动失败: ${msg}`);
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('docker:stop', async () => {
    const settings = settingsStore.load();
    const cmds = settingsStore.resolve(settings);
    try {
      log('info', `执行: ${cmds.stopCommand}`);
      const res = await docker.run(cmds.stopCommand, { timeoutMs: 30000 });
      if (res.code !== 0) {
        const msg = describeDockerError(res.stderr || res.stdout);
        log('warn', `停止命令返回退出码 ${res.code}: ${msg}`);
        return { ok: false, error: msg };
      }
      log('info', '容器已停止');
      return { ok: true };
    } catch (err) {
      const msg = describeDockerError(err.message);
      log('error', `停止失败: ${msg}`);
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('docker:status', async () => {
    const settings = settingsStore.load();
    const cmds = settingsStore.resolve(settings);
    try {
      const u = new URL(cmds.url);
      const up = await docker.tcpOpen(u.hostname, parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10), 1500);
      return { up, url: cmds.url };
    } catch (_) {
      return { up: false, url: cmds.url };
    }
  });

  // 列举容器内某目录下的子目录与文件（用于导出目录选择器）
  ipcMain.handle('docker:list-dir', async (_e, dirPath) => {
    const settings = settingsStore.load();
    const container = settings.containerName;
    const dir = normalizeContainerPath(dirPath);
    try {
      const base = ['docker', 'exec', container, 'find', dir, '-maxdepth', '1', '-mindepth', '1', '-type'];
      const [dirsRes, filesRes] = await Promise.all([
        docker.runArgs([...base, 'd', '-print'], { timeoutMs: 15000 }),
        docker.runArgs([...base, 'f', '-print'], { timeoutMs: 15000 })
      ]);

      if (dirsRes.code !== 0 && filesRes.code !== 0) {
        const msg = describeDockerError((dirsRes.stderr || '') + (filesRes.stderr || ''));
        return { ok: false, dir, parent: parentPath(dir), error: msg };
      }

      const prefix = dir === '/' ? '/' : dir + '/';
      const strip = (line) => {
        let name = line;
        if (name.startsWith(prefix)) name = name.slice(prefix.length);
        return name.replace(/\/+$/, '');
      };
      const dirs = dirsRes.stdout
        .split('\n')
        .map(strip)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      const files = filesRes.stdout
        .split('\n')
        .map(strip)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));

      return { ok: true, dir, parent: parentPath(dir), dirs, files };
    } catch (err) {
      return { ok: false, dir, parent: parentPath(dir), error: describeDockerError(err.message) };
    }
  });

  ipcMain.handle('docker:export', async (_e, payload) => {
    payload = payload || {};
    const settings = settingsStore.load();
    const source = payload.source || settings.exportSource;
    let dest = payload.dest;
    if (!dest) {
      const r = await dialog.showOpenDialog(mainWindow, {
        title: '选择导出目录',
        properties: ['openDirectory', 'createDirectory']
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
      dest = r.filePaths[0];
    }

    // 记住这次选择的源路径与目标目录，下次默认沿用
    settings.exportSource = source;
    settings.exportDest = dest;
    settingsStore.save(settings);
    const cmds = settingsStore.resolve(settings);
    try {
      log('info', `执行: ${cmds.exportCommand}`);
      const res = await docker.run(cmds.exportCommand, { timeoutMs: 300000 });
      if (res.code !== 0) {
        const msg = describeDockerError(res.stderr || res.stdout);
        log('error', `导出失败:\n${msg}`);
        return { ok: false, error: msg };
      }
      log('info', `导出完成 → ${dest}`);
      return { ok: true, source, dest, stdout: res.stdout, stderr: res.stderr };
    } catch (err) {
      const msg = describeDockerError(err.message);
      log('error', `导出失败: ${msg}`);
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('app:choose-dir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择导出目录',
      properties: ['openDirectory', 'createDirectory']
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('app:gpu-status', () => {
    try {
      const fs2 = app.getGPUFeatureStatus();
      const compositing = fs2 && fs2.gpu_compositing;
      return { gpuCompositing: compositing || 'unknown', featureStatus: fs2 || {} };
    } catch (e) {
      return { gpuCompositing: 'unknown', featureStatus: {} };
    }
  });

  ipcMain.handle('app:open-folder', async (_e, p) => {
    const err = await shell.openPath(p);
    return { ok: !err, error: err || '' };
  });

  ipcMain.handle('app:open-external', () => {
    const settings = settingsStore.load();
    const cmds = settingsStore.resolve(settings);
    openExternalWindow(cmds.url);
    return true;
  });

  // ---- 底层 WebContentsView 的布局与导航控制 ----
  ipcMain.handle('ui:layout', (_e, state) => {
    if (state && typeof state === 'object') {
      uiState = {
        toolbarH: Number(state.toolbarH) || uiState.toolbarH,
        debugH: Number(state.debugH) || 0,
        logH: Number(state.logH) || 0,
        modalOpen: !!state.modalOpen,
        guestHidden: !!state.guestHidden
      };
    }
    layoutGuest();
    return true;
  });

  ipcMain.handle('guest:load', (_e, url) => {
    if (!guestView) return false;
    guestView.webContents.loadURL(url).catch(() => {});
    return true;
  });

  ipcMain.handle('guest:reload', () => {
    if (guestView) guestView.webContents.reload();
    return true;
  });

  ipcMain.handle('guest:back', () => {
    if (guestView && guestView.webContents.canGoBack()) guestView.webContents.goBack();
    return true;
  });

  ipcMain.handle('guest:forward', () => {
    if (guestView && guestView.webContents.canGoForward()) guestView.webContents.goForward();
    return true;
  });

  ipcMain.handle('guest:get-url', () => {
    return guestView ? guestView.webContents.getURL() : '';
  });

  ipcMain.handle('guest:exec', async (_e, code) => {
    if (!guestView) return null;
    return await guestView.webContents.executeJavaScript(code);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
