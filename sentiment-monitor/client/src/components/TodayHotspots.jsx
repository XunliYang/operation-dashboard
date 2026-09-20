import { Card, List, Tag, Space, Empty, Statistic, Row, Col, Alert } from 'antd';
import { FireOutlined } from '@ant-design/icons';

const RISK_META = {
  high: { color: 'red', text: '高' },
  medium: { color: 'orange', text: '中' },
  low: { color: 'green', text: '低' },
};

const SENTIMENT_META = {
  positive: { color: 'green', text: '正面' },
  neutral: { color: 'default', text: '中性' },
  negative: { color: 'red', text: '负面' },
};

function formatTime(text) {
  if (!text) return '-';
  // 数据库存储的是 UTC 时间，统一转换为 UTC+8 展示
  const date = new Date(text.endsWith('Z') ? text : `${text}Z`);
  if (Number.isNaN(date.getTime())) return text;
  return new Date(date.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 16);
}

function HotspotList({ hotspots }) {
  const items = (hotspots && hotspots.items) || [];

  if (items.length === 0) {
    return <Empty description="今日暂无热点" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(item) => {
        const risk = RISK_META[item.risk_level];
        const sentiment = SENTIMENT_META[item.sentiment];
        return (
          <List.Item>
            <List.Item.Meta
              title={
                <Space size="small" wrap>
                  {risk && <Tag color={risk.color}>风险{risk.text}</Tag>}
                  {sentiment && <Tag color={sentiment.color}>{sentiment.text}</Tag>}
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.title || '(无标题)'}
                    </a>
                  ) : (
                    <span>{item.title || '(无标题)'}</span>
                  )}
                </Space>
              }
              description={
                <div>
                  {item.snippet && (
                    <div style={{ color: '#666', marginBottom: 4 }}>{item.snippet}</div>
                  )}
                  <Space size="small" style={{ fontSize: 12, color: '#999' }}>
                    <span>{item.source}</span>
                    <span>{formatTime(item.timestamp)}</span>
                  </Space>
                </div>
              }
            />
          </List.Item>
        );
      }}
    />
  );
}

function HotspotSummary({ summary }) {
  if (!summary) return null;

  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={12} sm={6}>
        <Statistic title="今日采集" value={summary.total} suffix="条" />
      </Col>
      <Col xs={12} sm={6}>
        <Statistic title="高风险" value={summary.risk.high} valueStyle={{ color: '#ff4d4f' }} />
      </Col>
      <Col xs={12} sm={6}>
        <Statistic title="负面" value={summary.sentiment.negative} valueStyle={{ color: '#fa541c' }} />
      </Col>
      <Col xs={12} sm={6}>
        <Statistic title="覆盖来源" value={summary.sources_count} suffix="个" />
      </Col>
    </Row>
  );
}

function TodayHotspots({ hotspots, summary, loading }) {
  return (
    <Card
      title={
        <Space>
          <FireOutlined style={{ color: '#fa541c' }} />
          <span>今日热点</span>
          {summary?.date && <span style={{ fontSize: 12, color: '#999' }}>{summary.date}</span>}
        </Space>
      }
      loading={loading}
    >
      {summary?.spike_detected && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="检测到负面舆情突增"
          description={`今日负面 ${summary.negative_today} 条，前 7 天日均 ${summary.negative_baseline_avg} 条。`}
        />
      )}
      <HotspotSummary summary={summary} />
      <HotspotList hotspots={hotspots} />
    </Card>
  );
}

export default TodayHotspots;
