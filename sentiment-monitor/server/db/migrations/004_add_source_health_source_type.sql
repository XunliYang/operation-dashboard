-- 迁移脚本：为 source_health 表添加 source_type 字段
--
-- 背景（LEOY-30）：collector.insertHealth 与 server/api/health.js 均引用
-- source_health.source_type，但 source_health 建表语句历史缺该列，001/002
-- 迁移也未补列，导致每轮采集收尾 insertHealth 抛
-- "table source_health has no column named source_type"。
-- 本迁移为该表补列；新建库由 schema.sql 已含该列，重复执行会报
-- "duplicate column name"，迁移 runner 会将其视为已应用，不中断启动。
ALTER TABLE source_health ADD COLUMN source_type TEXT;