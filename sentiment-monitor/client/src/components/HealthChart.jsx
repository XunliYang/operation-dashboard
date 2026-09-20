import { Card } from 'antd';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

function HealthChart({ data, title = '健康度趋势' }) {
  if (!data || data.length === 0) {
    return (
      <Card title={title}>
        <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>暂无数据</div>
      </Card>
    );
  }

  return (
    <Card title={title}>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="total_raw" stroke="#1890ff" name="原始数据" />
          <Line type="monotone" dataKey="total_filtered" stroke="#52c41a" name="过滤后" />
          <Line type="monotone" dataKey="anomaly_count" stroke="#ff4d4f" name="异常源" />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

export default HealthChart;
