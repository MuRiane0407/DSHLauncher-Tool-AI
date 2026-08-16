# DSH Launcher

English | [中文](README.zh-CN.md)

An Electron desktop utility for managing DSH running inside a Docker container from your host machine:

- **One-click start**: `docker start <container>` → launch `dsh web` in the container → wait for `http://localhost:3080/` to be ready
- **Embedded browser**: loads and controls `http://localhost:3080/` directly inside the window
- **One-click export**: `docker cp` copies the project directory out of the container to any local folder, with a built-in directory browser for visually picking what to export
- **Configurable**: the container name is its own field; the start/stop/export commands are all editable templates
- **Run log**: a bottom log panel shows every command and error in real time for easy debugging

## Requirements

- **Docker** installed on the host (Docker Desktop or native Linux Docker), with `docker` on your `PATH`
- An existing dsh container (example name `dsh-modified`), visible via `docker ps -a`. If you don't have one yet, see this tutorial: [How to build a dsh container (CSDN)](https://blog.csdn.net/oushaojun2/article/details/163758882)
- Node.js ≥ 18 (only needed for development/packaging; the packaged output needs no Node)

## Quick start (development)

```bash
cd dsh-launcher   # project directory
npm install
npm start
```

> On Linux, running Electron as root may require `npm start -- --no-sandbox`.

## Build executables

```bash
npm run dist          # current platform
npm run dist:win      # Windows (NSIS installer + portable)
npm run dist:mac      # macOS (dmg)
npm run dist:linux    # Linux (AppImage + deb)
```

Output goes to the `release/` directory.

> Cross-platform builds are best run on the target OS (e.g. build the exe on Windows). The first build downloads Electron and build dependencies and needs network access.

## Launch without a console & app icon

- **Icon**: `build/icon.png` (512×512), generated via `npm run icon`. The window icon works in development mode; the packaged exe/AppImage/dmg **embeds the icon**.
- **On Windows, no cmd window each time**: double-click **`launch-dsh.vbs`** in the project root to start silently (it invokes `node_modules\electron\dist\electron.exe` directly, no console window). Requires `npm install` first.
- **Simplest option**: after packaging, double-click `release\DSH Launcher 1.0.0.exe` — **no console, with icon**; you can create a desktop shortcut (right-click → Send to → Desktop). Build command:

```powershell
npm.cmd run dist:win
```

## Settings

Click "Settings" in the top-right of the window. Field reference:

| Field | Default | Meaning |
| --- | --- | --- |
| Container name | `dsh-modified` | Your dsh container name; usually this is the only thing you change |
| Port | `3080` | The port mapped to `localhost` on the host |
| Project dir in container (for export) | `/root/projects` | The source path copied out of the container; set it to the actual path inside your container |
| Wait-for-ready timeout | `60000` | Max time (ms) to wait for the web page after starting |

Command templates support placeholders `{container}` `{port}` `{source}` `{dest}`:

| Command | Default |
| --- | --- |
| Start container | `docker start {container}` |
| Start dsh web | `docker exec -d {container} node --expose-internals /usr/local/bin/dsh web --host 0.0.0.0` |
| Stop container | `docker stop {container}` |
| Embedded browser URL | `http://localhost:{port}/` |
| Export command | `docker cp "{container}:{source}" "{dest}"` |

Notes:

- The web-start command uses `-d` (detached, returns immediately). The trailing `&` from a manual shell is not needed (and means something different under Windows cmd).
- If `docker` isn't on `PATH`, change `docker` in the templates to an absolute path (e.g. `/usr/bin/docker` on Linux or `"C:\Program Files\Docker\Docker\resources\bin\docker.exe"` on Windows).
- If the port differs, just change the "Port" field — the URL template substitutes `{port}` automatically.
- "Debug mode" shows FPS / URL / connection status in the top-right corner; turn it off when you don't need it.
- With "Auto-start Docker Desktop when the engine is not running" enabled, clicking Start first launches Docker Desktop and waits for the engine (up to 90s). If Docker Desktop is installed elsewhere, change the "Docker Desktop path" field.

## Usage

1. On first open, go to "Settings", confirm the container name, and set "Project dir in container (for export)".
2. Click "Start": it runs `docker start` → starts `dsh web` in the container → loads the page into the embedded browser once ready.
3. Click "Export project": browse the container's directories in the dialog (click a folder to enter, "↑ Up" to go back, "Use current directory" to set the export source) → choose a local target folder → "Start export", which runs `docker cp` to copy the selected directory out; then you can "Open export folder".
4. Click "Stop": runs `docker stop <container>`.

## FAQ

- **Start failed: docker command not found** — Docker isn't installed or not on `PATH`; see Settings.
- **Docker permission denied** — on Linux run `sudo usermod -aG docker $USER` and re-login.
- **Container not found** — check the name with `docker ps -a` and fix "Settings → Container name".
- **Export failed / source path not found** — the in-container project path is wrong; verify with `docker exec <container> ls <path>` and fix "Settings → Project dir".
- **Page stays "not ready"** — open "Log" to see the command and error; make sure the port mapping is correct (`docker ps` shows `0.0.0.0:3080->3080`).
- **Embedded page blank / failed to load** — first confirm `http://localhost:3080/` opens in a normal browser; if dsh web isn't ready yet, click "⟳" in the toolbar.

## Directory structure

```
src/
  main/
    main.js       Electron main process: window, IPC, start/stop/export flow
    settings.js   settings read/write and command-template rendering
    docker.js     command execution, health checks
    preload.js    renderer bridge (contextBridge)
  renderer/
    index.html    UI
    styles.css    styles
    renderer.js   UI logic
```
