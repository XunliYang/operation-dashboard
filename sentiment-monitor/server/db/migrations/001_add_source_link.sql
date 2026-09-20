-- 迁移脚本：为 source_health 表添加 link 字段
ALTER TABLE source_health ADD COLUMN link TEXT;
