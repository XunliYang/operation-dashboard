/**
 * 数据库迁移脚本 - 为 items 表添加新字段
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/sentiment.db');

function migrate() {
  const db = new Database(DB_PATH);
  
  console.log('开始数据库迁移...');
  
  // 检查字段是否存在
  const columns = db.prepare("PRAGMA table_info(items)").all();
  const columnNames = columns.map(c => c.name);
  
  if (!columnNames.includes('collection_id')) {
    console.log('添加 collection_id 字段...');
    db.exec('ALTER TABLE items ADD COLUMN collection_id INTEGER REFERENCES collection_history(id) ON DELETE SET NULL');
  }
  
  if (!columnNames.includes('status')) {
    console.log('添加 status 字段...');
    db.exec('ALTER TABLE items ADD COLUMN status TEXT DEFAULT "pending"');
  }
  
  if (!columnNames.includes('is_summary')) {
    console.log('添加 is_summary 字段...');
    db.exec('ALTER TABLE items ADD COLUMN is_summary INTEGER DEFAULT 0');
  }
  
  // 添加索引
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_collection ON items(collection_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_status ON items(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_summary ON items(is_summary)');
    console.log('索引创建完成');
  } catch (err) {
    console.log('索引可能已存在:', err.message);
  }
  
  console.log('数据库迁移完成');
  db.close();
}

if (require.main === module) {
  migrate();
}

module.exports = migrate;
