@echo off
cd /d "%~dp0"

echo ==========================================
echo   舆情监控系统 - 启动脚本
echo ==========================================

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 未找到 Node.js，请先安装 Node.js v18+
    pause
    exit /b 1
)

echo Node.js 版本:
node -v

REM Install backend dependencies
if not exist "node_modules" (
    echo 安装后端依赖...
    call npm install --production
)

REM Install frontend dependencies
if not exist "client\node_modules" (
    echo 安装前端依赖...
    cd client
    call npm install
    cd ..
)

REM Build frontend
if not exist "client\dist" (
    echo 构建前端...
    cd client
    call npm run build
    cd ..
)

REM Create data directory
if not exist "data\backups" mkdir data\backups

echo.
echo 启动服务...
echo 访问地址: http://localhost:3000
echo ==========================================

node server/index.js
