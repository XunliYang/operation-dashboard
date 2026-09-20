-- 迁移脚本：为 items 表添加 source_type 字段
ALTER TABLE items ADD COLUMN source_type TEXT;
