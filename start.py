#!/usr/bin/env python3
"""WaveBank Otakus unified launcher.

Starts the Flask backend and the Vite frontend together, so users only need:

    python start.py

Works on Linux, macOS and Windows. Optional flags:
    --no-browser    do not open the browser automatically
    --no-install    skip automatic dependency setup
"""

from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"

BACKEND_HOST = os.environ.get("WAVEBANK_HOST", "127.0.0.1")
BACKEND_PORT = int(os.environ.get("WAVEBANK_PORT", "5000"))
FRONTEND_PORT = int(os.environ.get("WAVEBANK_FRONTEND_PORT", "5173"))

BACKEND_URL = f"http://{BACKEND_HOST}:{BACKEND_PORT}"
FRONTEND_URL = f"http://localhost:{FRONTEND_PORT}"
FRONTEND_CHECK_URL = f"http://127.0.0.1:{FRONTEND_PORT}"


def is_windows() -> bool:
    return os.name == "nt"


def venv_python() -> Path | None:
    if is_windows():
        candidate = BACKEND_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        candidate = BACKEND_DIR / ".venv" / "bin" / "python"
    return candidate if candidate.exists() else None


def find_system_python() -> str | None:
    for name in ("py", "python3", "python"):
        path = shutil.which(name)
        if path:
            return path
    return None


def ensure_backend_python() -> str:
    existing = venv_python()
    if existing:
        return str(existing)

    system_python = find_system_python()
    if not system_python:
        print("错误：未找到 Python，且 backend/.venv 不存在。", file=sys.stderr)
        raise SystemExit(1)

    print("正在创建 backend/.venv ...")
    subprocess.run(
        [system_python, "-m", "venv", str(BACKEND_DIR / ".venv")],
        check=True,
    )
    python = venv_python()
    if not python:
        print("错误：创建虚拟环境后仍未找到 Python。", file=sys.stderr)
        raise SystemExit(1)

    print("正在安装后端依赖 ...")
    subprocess.run(
        [str(python), "-m", "pip", "install", "-r", str(BACKEND_DIR / "requirements.txt")],
        check=True,
    )
    return str(python)


def ensure_frontend_dependencies() -> str:
    if (FRONTEND_DIR / "node_modules").is_dir():
        npm = shutil.which("npm")
        if npm:
            return npm

    npm = shutil.which("npm")
    if not npm:
        print("错误：未找到 npm，无法启动前端。", file=sys.stderr)
        raise SystemExit(1)

    print("正在安装前端依赖（npm install）...")
    subprocess.run(["npm", "install"], cwd=str(FRONTEND_DIR), check=True)
    return npm


def stream_output(process: subprocess.Popen[str], prefix: str) -> None:
    assert process.stdout is not None
    for line in iter(process.stdout.readline, ""):
        sys.stdout.write(f"[{prefix}] {line}")
        sys.stdout.flush()


def start_process(command: list[str], cwd: Path, prefix: str) -> subprocess.Popen[str]:
    kwargs: dict = {
        "cwd": str(cwd),
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
    }
    if is_windows():
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True

    process = subprocess.Popen(command, **kwargs)
    threading.Thread(
        target=stream_output,
        args=(process, prefix),
        daemon=True,
    ).start()
    return process


def stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        if is_windows():
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                check=False,
            )
        else:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        process.kill()


def wait_for_url(url: str, timeout: float = 30) -> bool:
    deadline = time.time() + timeout
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    while time.time() < deadline:
        try:
            with opener.open(url, timeout=2) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)

    parser = argparse.ArgumentParser(description="WaveBank Otakus 一键启动")
    parser.add_argument("--no-browser", action="store_true", help="启动后不自动打开浏览器")
    parser.add_argument("--no-install", action="store_true", help="跳过自动依赖安装")
    args = parser.parse_args()

    if not args.no_install:
        backend_python = ensure_backend_python()
        npm = ensure_frontend_dependencies()
    else:
        backend_python = venv_python()
        if not backend_python:
            print("错误：backend/.venv 不存在，且 --no-install 已禁用自动创建。", file=sys.stderr)
            raise SystemExit(1)
        backend_python = str(backend_python)
        npm = shutil.which("npm")
        if not npm:
            print("错误：未找到 npm。", file=sys.stderr)
            raise SystemExit(1)

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["WAVEBANK_DEBUG"] = "0"
    env.setdefault("WAVEBANK_HOST", BACKEND_HOST)
    env.setdefault("WAVEBANK_PORT", str(BACKEND_PORT))

    backend_command = [backend_python, "-m", "backend.run"]
    frontend_command = ["npm", "run", "dev"]

    print("正在启动后端（Flask）...")
    backend = start_process(backend_command, ROOT_DIR, "backend")
    print("正在启动前端（Vite）...")
    frontend = start_process(frontend_command, FRONTEND_DIR, "frontend")

    try:
        if not wait_for_url(f"{BACKEND_URL}/api/health"):
            print("后端未在预期时间内就绪。", file=sys.stderr)
            raise SystemExit(1)
        print(f"后端已就绪：{BACKEND_URL}")

        if not wait_for_url(FRONTEND_CHECK_URL, timeout=15):
            print("前端未在预期时间内就绪。", file=sys.stderr)
            raise SystemExit(1)
        print(f"前端已就绪：{FRONTEND_URL}")
        print(f"打开浏览器访问：{FRONTEND_URL}（Ctrl+C 同时退出前后端）")

        if not args.no_browser:
            webbrowser.open(FRONTEND_URL)

        while True:
            time.sleep(1)
            if backend.poll() is not None:
                print("后端进程已退出，正在关闭前端。", file=sys.stderr)
                raise SystemExit(backend.returncode or 1)
            if frontend.poll() is not None:
                print("前端进程已退出，正在关闭后端。", file=sys.stderr)
                raise SystemExit(frontend.returncode or 1)
    except KeyboardInterrupt:
        print("\n收到退出信号，正在关闭前后端 ...")
    finally:
        stop_process(backend)
        stop_process(frontend)


if __name__ == "__main__":
    main()
