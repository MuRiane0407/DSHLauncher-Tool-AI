'use strict';

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');

/**
 * 内部通用执行器。
 * config.cmd  —— 走 shell 解释（兼容 Windows cmd / Unix sh），可写管道、引号；
 * config.args —— 按参数数组直接 spawn（不经 shell，避免引号/转义差异）。
 * 返回 { code, stdout, stderr }。
 */
function spawnProcess(config, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = config.cmd
        ? spawn(config.cmd, { shell: true, windowsHide: true })
        : spawn(config.args[0], config.args.slice(1), { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill();
        } catch (_) {
          /* ignore */
        }
        const desc = config.cmd || config.args.join(' ');
        reject(new Error(`命令超时 (${timeoutMs}ms): ${desc}`));
      }
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      }
    });
  });
}

/** 执行一条 shell 命令字符串。 */
function run(cmd, opts) {
  return spawnProcess({ cmd }, opts);
}

/** 按参数数组执行命令（不经 shell，参数里的空格/引号等无需转义）。 */
function runArgs(args, opts) {
  return spawnProcess({ args }, opts);
}

/** 对 http/https 地址发起一次 GET，只要能建立连接并收到响应即视为“就绪”。 */
function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    let lib;
    try {
      lib = String(url).startsWith('https:') ? https : http;
    } catch (_) {
      lib = http;
    }
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch (_) {
        /* ignore */
      }
      resolve(false);
    });
  });
}

/** 轮询等待 url 可访问，超时返回 false。onTick 在每次重试前调用（用于打日志）。 */
async function waitForUrl(url, timeoutMs, onTick) {
  const start = Date.now();
  if (await httpGet(url, 3000)) return true;
  while (Date.now() - start < timeoutMs) {
    if (onTick) onTick();
    await new Promise((r) => setTimeout(r, 1000));
    if (await httpGet(url, 3000)) return true;
  }
  return httpGet(url, 3000);
}

/** 轻量 TCP 探测：端口可连接即视为“服务在监听”。用于状态轮询，避免反复发 HTTP 请求。 */
function tcpOpen(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: timeoutMs });
    const done = (ok) => {
      try {
        socket.destroy();
      } catch (_) {
        /* ignore */
      }
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

/** 探测一次 docker 守护进程是否就绪（执行 docker info，退出码 0 视为就绪）。 */
async function daemonUp() {
  try {
    const r = await run('docker info', { timeoutMs: 8000 });
    return r.code === 0;
  } catch (_) {
    return false;
  }
}

/** 轮询等待 docker 守护进程就绪，超时返回 false。 */
async function waitForDaemon(timeoutMs, onTick) {
  const start = Date.now();
  if (await daemonUp()) return true;
  while (Date.now() - start < timeoutMs) {
    if (onTick) onTick();
    await new Promise((r) => setTimeout(r, 2000));
    if (await daemonUp()) return true;
  }
  return daemonUp();
}

/** 启动 Docker Desktop（GUI 程序，detached 不等待）。返回是否成功发起启动。 */
function launchDockerDesktop(exePath) {
  try {
    if (!exePath || !fs.existsSync(exePath)) return false;
    const child = spawn(exePath, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { run, runArgs, httpGet, waitForUrl, tcpOpen, daemonUp, waitForDaemon, launchDockerDesktop };
