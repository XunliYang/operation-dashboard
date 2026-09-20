#!/bin/bash
cd "$(dirname "$0")"

echo "=========================================="
echo "  舆情监控系统 - 启动脚本"
echo "=========================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请先安装 Node.js v18+"
    exit 1
fi

echo "Node.js 版本: $(node -v)"

# Install backend dependencies
if [ ! -d "node_modules" ]; then
    echo "安装后端依赖..."
    npm install --production
fi

# Install frontend dependencies
if [ ! -d "client/node_modules" ]; then
    echo "安装前端依赖..."
    cd client && npm install && cd ..
fi

# Build frontend
if [ ! -d "client/dist" ]; then
    echo "构建前端..."
    cd client && npm run build && cd ..
fi

# Create data directory
mkdir -p data/backups

echo ""
echo "启动服务..."
echo "访问地址: http://localhost:3000"
echo "=========================================="

node server/index.js
