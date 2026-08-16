'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * 默认设置。
 * 命令模板支持占位符：
 *   {container} 容器名
 *   {port}      端口
 *   {source}    容器内项目目录（导出用）
 *   {dest}      导出目标目录（导出用）
 */
const DEFAULTS = {
  containerName: 'dsh-modified',
  port: 3080,

  // 启动容器
  startCommand: 'docker start {container}',
  // 在容器内启动 dsh web 服务（-d 表示后台运行，避免阻塞）
  webCommand:
    'docker exec -d {container} node --expose-internals /usr/local/bin/dsh web --host 0.0.0.0',
  // 停止容器
  stopCommand: 'docker stop {container}',

  // 内嵌浏览器访问地址
  url: 'http://localhost:{port}/',

  // 导出：容器内的项目目录（请按你容器里的实际路径修改）
  exportSource: '/root/projects',
  // 导出命令
  exportCommand: 'docker cp "{container}:{source}" "{dest}"',
  // 上次使用的导出目录（可选，空则每次弹窗选择）
  exportDest: '',

  // 等待 web 服务就绪的超时（毫秒）
  healthCheckTimeoutMs: 60000,

  // 调试模式：在界面右上角显示 FPS 等诊断信息
  debugMode: false,

  // 性能：要隐藏的元素 CSS 选择器（逗号/换行分隔），例如桌宠动画元素，如 .pet, #live2d
  hideSelectors: '',

  // 性能：注入页面的自定义 CSS（可覆盖插件样式，例如去掉装饰层的阴影滤镜）
  injectCss: '',

  // Docker 引擎：未运行时自动启动 Docker Desktop（Windows）
  autoStartDocker: true,
  // Docker Desktop 可执行文件路径（按实际安装位置修改）
  dockerDesktopPath: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'
};

function settingsPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  const merged = { ...DEFAULTS, ...(settings || {}) };
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function render(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) =>
    vars[k] != null ? String(vars[k]) : m
  );
}

/** 把设置里的模板渲染成最终要执行的命令。 */
function resolve(settings) {
  const s = { ...DEFAULTS, ...(settings || {}) };
  const vars = {
    container: s.containerName,
    port: s.port,
    source: s.exportSource,
    dest: s.exportDest || ''
  };
  return {
    startCommand: render(s.startCommand, vars),
    webCommand: render(s.webCommand, vars),
    stopCommand: render(s.stopCommand, vars),
    exportCommand: render(s.exportCommand, vars),
    url: render(s.url, vars)
  };
}

module.exports = { DEFAULTS, load, save, resolve };
