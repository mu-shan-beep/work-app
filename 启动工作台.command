#!/bin/bash
cd "$(dirname "$0")/00-入口" || exit 1
echo "正在启动个人工作台…（关闭此窗口即停止服务）"
echo ""
python3 -u server.py 2>&1 | tee /tmp/wb_launch.log
echo ""
echo "服务已退出。按任意键关闭窗口。"
read -n 1
