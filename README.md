# DSH Launcher

一个 Electron 桌面小工具，用来在你本机（宿主机）上管理运行在 Docker 容器里的 DSH：

- **一键启动**：`docker start <容器>` → 在容器内启动 `dsh web` → 等待 `http://localhost:3080/` 就绪
- **内嵌浏览器**：窗口内直接加载并操作 `http://localhost:3080/`
- **一键导出**：`docker cp` 把容器内的项目目录拷贝到本机任意目录，且内置容器内目录浏览器，可视化点选要导出的文件夹
- **可配置**：容器名是独立字段，其余启动/停止/导出命令都是可编辑的模板
- **运行日志**：底部日志面板实时显示每条命令与报错，方便排查

## 环境要求

- 宿主机已安装 **Docker**（Docker Desktop 或 Linux 原生 docker），且 `docker` 命令在当前 PATH 中
- 已有一个 dsh 容器（示例名 `dsh-modified`），可通过 `docker ps -a` 看到
- Node.js ≥ 18（仅开发/打包时需要；打包出的产物无需 Node）

## 快速开始（开发模式）

```bash
cd dsh-launcher   # 本项目目录
npm install
npm start
```

> Linux 下若以 root 运行 Electron，可能需 `npm start -- --no-sandbox`。

## 打包成可执行程序

```bash
npm run dist          # 当前系统
npm run dist:win      # Windows（nsis 安装包 + portable）
npm run dist:mac      # macOS（dmg）
npm run dist:linux    # Linux（AppImage + deb）
```

产物输出到 `release/` 目录。

> 跨平台打包建议在对应系统上执行（例如在 Windows 上打 exe）。首次打包会自动下载 Electron/构建依赖，需要联网。

## 无控制台启动 & 应用图标

- **图标**：`build/icon.png`（512×512），由 `npm run icon` 生成。窗口图标在开发模式下即可生效；打包出的 exe/AppImage/dmg 会**内嵌该图标**。
- **Windows 下不想每次开 cmd**：双击项目根目录的 **`launch-dsh.vbs`** 即可静默启动（直接调用 `node_modules\electron\dist\electron.exe`，不弹命令行窗口）。前提是已 `npm install`。
- **最省事的方案**：打包成便携版 exe 后，双击 `release\DSH Launcher 1.0.0.exe` 运行——**无控制台窗口、带图标**，可以给它建个桌面快捷方式（右键 → 发送到 → 桌面快捷方式）。打包命令：

```powershell
npm.cmd run dist:win
```

## 设置说明

点击窗口右上角「设置」。字段含义：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| 容器名 | `dsh-modified` | 你的 dsh 容器名，一般只需改这里 |
| 端口 | `3080` | 容器映射到宿主机 `localhost` 的端口 |
| 容器内项目目录（导出用） | `/root/projects` | 导出时从容器里拷贝的源路径，按你容器内的实际路径改 |
| 等待服务就绪超时 | `60000` | 启动后轮询等待网页就绪的最长时间（毫秒） |

命令模板支持占位符 `{container}` `{port}` `{source}` `{dest}`：

| 命令 | 默认值 |
| --- | --- |
| 启动容器 | `docker start {container}` |
| 启动 dsh web | `docker exec -d {container} node --expose-internals /usr/local/bin/dsh web --host 0.0.0.0` |
| 停止容器 | `docker stop {container}` |
| 内嵌浏览器地址 | `http://localhost:{port}/` |
| 导出命令 | `docker cp "{container}:{source}" "{dest}"` |

说明：

- 启动 web 命令默认加了 `-d`（后台运行，立即返回）。你原来命令行里的 `&` 已不需要，否则在 Windows 的 cmd 下含义不同。
- 如果 `docker` 不在 PATH，把模板里的 `docker` 改成绝对路径（如 Linux 的 `/usr/bin/docker` 或 Windows 的 `"C:\Program Files\Docker\Docker\resources\bin\docker.exe"`）即可。
- 端口如与默认不同，同时改「端口」字段即可，地址模板会自动替换 `{port}`。
- 「调试模式」勾选后，界面右上角会显示 FPS / URL / 连接状态，用于排查卡顿；不需要时取消勾选即可。
- 「引擎未运行时自动启动 Docker Desktop」勾选后，点「启动」若发现 Docker 引擎未运行，会先自动拉起 Docker Desktop 并等待引擎就绪（最长 90 秒）。若 Docker Desktop 装在别处，改「Docker Desktop 路径」字段。

## 使用流程

1. 首次打开点「设置」，确认容器名正确，改好「容器内项目目录（导出用）」。
2. 点「启动」：会自动 `docker start` → 启动容器内 dsh web → 等服务就绪后把网页加载进内嵌浏览器。
3. 点「导出项目」：在弹窗里用**目录浏览器**浏览容器内的目录（点文件夹进入、点「↑ 上级」返回、点「选用当前目录」把当前目录设为导出源）→ 选择本机目标目录 → 「开始导出」，会用 `docker cp` 把选中的容器内目录拷到本机，完成后可「打开导出目录」。
4. 点「停止」：执行 `docker stop <容器>`。

## 常见问题

- **启动失败：未找到 docker 命令** —— Docker 未安装或未加入 PATH，见「设置说明」。
- **docker 权限不足** —— Linux 下执行 `sudo usermod -aG docker $USER` 后注销重登。
- **容器不存在** —— 用 `docker ps -a` 核对容器名，改「设置 → 容器名」。
- **导出失败 / 找不到源路径** —— 容器内项目目录填错，用 `docker exec <容器> ls <路径>` 核对后改「设置 → 容器内项目目录」。
- **网页一直显示未就绪** —— 点「日志」查看具体命令与报错；确认容器端口映射正确（`docker ps` 看 `0.0.0.0:3080->3080`）。
- **内嵌页面空白/加载失败** —— 先确认本机浏览器能直接打开 `http://localhost:3080/`；dsh web 未就绪时点工具栏「⟳」刷新。

## 目录结构

```
src/
  main/
    main.js       Electron 主进程：窗口、IPC、启动/停止/导出流程
    settings.js   设置读写与命令模板渲染
    docker.js     命令执行、健康检查
    preload.js    渲染进程桥接（contextBridge）
  renderer/
    index.html    界面
    styles.css    样式
    renderer.js   界面逻辑
```
