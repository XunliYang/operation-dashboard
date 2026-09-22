import { Card } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

function StatCard({ title, value, icon, color = '#1890ff', trend }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px', whiteSpace: 'nowrap' }}>{title}</div>
          <div style={{ fontSize: '28px', fontWeight: 'bold', color }}>{value}</div>
          {trend !== undefined && (
            <div style={{ fontSize: '12px', marginTop: '4px', color: trend >= 0 ? '#52c41a' : '#ff4d4f' }}>
              {trend >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(trend)}%
            </div>
          )}
        </div>
        <div style={{ fontSize: '48px', color, opacity: 0.2 }}>{icon}</div>
      </div>
    </Card>
  );
}

export default StatCard;
