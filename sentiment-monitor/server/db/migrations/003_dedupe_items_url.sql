-- LEOY-7 · P0-2：采集去重。
--
-- 事实：collector.js 用 `INSERT OR IGNORE`，但 items.url 只是普通 TEXT、无唯一约束，
-- OR IGNORE 永不触发，同一条新闻每天重复入库，系统性放大「每日文档量 / 情感分布」。
--
-- 本迁移先清洗存量重复（同 project_id + 非空 url 只保留 MIN(id) 一条），再加部分唯一索引。
-- 空 url 必须用 `url <> ''` 隔离：空 url 行不参与去重（显式保留策略），
-- 否则所有空 url 行会被合并成一行。迁移幂等：重复执行时 DELETE 无匹配行、索引 IF NOT EXISTS 跳过。

DELETE FROM items
 WHERE url <> ''
   AND id NOT IN (
     SELECT MIN(id) FROM items WHERE url <> '' GROUP BY project_id, url
   );

CREATE UNIQUE INDEX IF NOT EXISTS uniq_items_project_url
  ON items(project_id, url)
  WHERE url <> '';
