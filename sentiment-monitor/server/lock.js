const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const LOCK_FILE = path.join(__dirname, '../data/.lock');

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const pid = fs.readFileSync(LOCK_FILE, 'utf-8').trim();

    try {
      process.kill(pid, 0);
      throw new Error(`另一个进程正在运行 (PID: ${pid})`);
    } catch (e) {
      if (e.code === 'ESRCH') {
        logger.warn('发现残留锁文件，清理中', { pid });
        fs.unlinkSync(LOCK_FILE);
      } else if (e.code === 'EPERM') {
        throw new Error(`无权限检查进程 (PID: ${pid})`);
      } else {
        throw e;
      }
    }
  }

  fs.writeFileSync(LOCK_FILE, process.pid.toString());
  logger.info('获取锁成功', { pid: process.pid });
}

function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
    logger.info('释放锁', { pid: process.pid });
  }
}

function isLocked() {
  return fs.existsSync(LOCK_FILE);
}

module.exports = { acquireLock, releaseLock, isLocked };
