/**
 * cli-tools.js - CLI 工具检查和安装辅助模块
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const CLI_PATH = process.env.AGENT_REACH_BIN || '/opt/data/home/.local/bin';

/**
 * 检查命令是否可用
 * @param {string} command - 命令名称
 * @returns {Promise<boolean>} 是否可用
 */
function checkCommand(command) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const checkCmd = isWindows ? `where ${command}` : `which ${command}`;
    
    exec(checkCmd, (error) => {
      resolve(!error);
    });
  });
}

/**
 * 检查多个命令是否可用
 * @param {string[]} commands - 命令列表
 * @returns {Promise<Object>} 检查结果 { command: boolean }
 */
async function checkCommands(commands) {
  const results = {};
  for (const cmd of commands) {
    results[cmd] = await checkCommand(cmd);
  }
  return results;
}

/**
 * 获取所有依赖的 CLI 工具及其状态
 * @returns {Promise<Object>} 工具状态
 */
async function getToolsStatus() {
  const tools = {
    // 必需工具
    curl: { required: true, description: 'HTTP 请求工具' },
    
    // Agent-Reach 工具
    mcporter: { required: false, description: 'MCP 工具调用（Exa、微博等）' },
    xhs: { required: false, description: '小红书搜索' },
    bili: { required: false, description: 'B站搜索' },
    
    // 可选工具
    agent_reach: { required: false, description: 'Agent Reach 主程序' },
  };
  
  const status = {};
  
  for (const [tool, info] of Object.entries(tools)) {
    const available = await checkCommand(tool);
    status[tool] = {
      available,
      required: info.required,
      description: info.description,
    };
  }
  
  return status;
}

/**
 * 打印工具状态
 * @param {Object} status - 工具状态
 */
function printToolsStatus(status) {
  console.log('\n📋 CLI 工具状态检查:');
  console.log('-'.repeat(50));
  
  for (const [tool, info] of Object.entries(status)) {
    const statusIcon = info.available ? '✅' : (info.required ? '❌' : '⚠️');
    const requiredText = info.required ? '(必需)' : '(可选)';
    console.log(`   ${statusIcon} ${tool.padEnd(15)} ${requiredText.padEnd(8)} ${info.description}`);
  }
  
  console.log('-'.repeat(50));
  
  // 检查必需工具
  const missingRequired = Object.entries(status)
    .filter(([_, info]) => info.required && !info.available)
    .map(([tool]) => tool);
  
  if (missingRequired.length > 0) {
    console.log(`\n❌ 缺少必需工具: ${missingRequired.join(', ')}`);
    console.log('请安装后再运行采集任务');
    return false;
  }
  
  // 提示可选工具
  const missingOptional = Object.entries(status)
    .filter(([_, info]) => !info.required && !info.available)
    .map(([tool]) => tool);
  
  if (missingOptional.length > 0) {
    console.log(`\n⚠️ 缺少可选工具: ${missingOptional.join(', ')}`);
    console.log('这些工具对应的数据源将被跳过');
  }
  
  return true;
}

/**
 * 获取安装指南
 * @returns {string} 安装指南文本
 */
function getInstallGuide() {
  return `
📦 CLI 工具安装指南
${'='.repeat(50)}

1. mcporter (MCP 工具调用)
   npm install -g mcporter

2. xhs (小红书搜索)
   npm install -g xhs-cli

3. bili (B站搜索)
   npm install -g bili-cli

4. agent-reach (Agent Reach 主程序)
   npm install -g agent-reach

5. curl (HTTP 请求)
   - Windows: 已内置
   - Linux: sudo apt install curl
   - macOS: 已内置

${'='.repeat(50)}
`;
}

module.exports = {
  checkCommand,
  checkCommands,
  getToolsStatus,
  printToolsStatus,
  getInstallGuide,
};
