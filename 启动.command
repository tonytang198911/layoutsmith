#!/bin/bash
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 launcher.py
else
  echo "没有找到 python3。可以换一种方式：在这个文件夹里执行"
  echo "  python3 -m http.server 8787"
  echo "然后浏览器打开 http://127.0.0.1:8787/"
  read -r -p "按回车关闭…"
fi
