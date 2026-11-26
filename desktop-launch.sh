#!/bin/bash
# 排版大师桌面快捷入口：已运行时直接打开；未运行时在后台启动本机服务。
set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
URL="http://127.0.0.1:8787/"
CHECK="http://127.0.0.1:8787/__lbcheck__"
LOG="/tmp/layoutsmith-desktop.log"

alive() {
  /usr/bin/curl -fsS --max-time 1 "$CHECK" 2>/dev/null | /usr/bin/grep -q "layoutsmith"
}

open_app() {
  if [ "${LAYOUTSMITH_NO_BROWSER:-0}" = "1" ]; then
    echo "running"
  else
    /usr/bin/open "$URL"
  fi
}

if alive; then
  open_app
  exit 0
fi

if [ ! -d "$APP_DIR" ]; then
  /usr/bin/osascript -e 'display alert "排版大师目录不存在" message "快捷方式指向的文件夹被移动或删除了：/Users/relx/Desktop/RELX/Indonesia/17 IDN IT/layoutsmith" as critical' >/dev/null 2>&1
  exit 1
fi

PYTHON="$(command -v python3 || true)"
if [ -z "$PYTHON" ]; then
  /usr/bin/osascript -e 'display alert "没有找到 Python 3" message "请先安装 Python 3，或双击项目里的 启动.command。" as critical' >/dev/null 2>&1
  exit 1
fi

cd "$APP_DIR" || exit 1
export LAYOUTSMITH_NO_OPEN=1
nohup "$PYTHON" launcher.py </dev/null >>"$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 90); do
  if alive; then
    open_app
    exit 0
  fi
  sleep 0.2
done

/usr/bin/osascript -e 'display alert "排版大师启动失败" message "请查看 /tmp/layoutsmith-desktop.log，或双击项目里的 启动.command。" as critical' >/dev/null 2>&1
exit 1
