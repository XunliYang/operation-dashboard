import { Card, List, Tag, Button } from 'antd';
import { decisionsApi } from '../services/api';

function DecisionList({ decisions, onRefresh }) {
  const handleUndo = async (id) => {
    try {
      await decisionsApi.undo(id);
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('撤销决策失败:', error);
    }
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'disable_source': return 'red';
      case 'check_config': return 'orange';
      case 'strict_filter': return 'blue';
      default: return 'default';
    }
  };

  const getActionText = (action) => {
    switch (action) {
      case 'disable_source': return '禁用源';
      case 'check_config': return '检查配置';
      case 'strict_filter': return '严格过滤';
      default: return action;
    }
  };

  return (
    <Card title="最近决策">
      <List
        dataSource={decisions || []}
        renderItem={(item) => (
          <List.Item
            actions={[
              <Button size="small" onClick={() => handleUndo(item.id)}>
                撤销
              </Button>
            ]}
          >
            <List.Item.Meta
              title={
                <span>
                  <Tag color={getActionColor(item.action)}>{getActionText(item.action)}</Tag>
                  {item.target}
                </span>
              }
              description={
                <div>
                  <div>{item.reason}</div>
                  <div style={{ fontSize: '12px', color: '#999' }}>
                    {new Date(item.executed_at).toLocaleString('zh-CN')}
                  </div>
                </div>
              }
            />
          </List.Item>
        )}
        locale={{ emptyText: '暂无决策记录' }}
      />
    </Card>
  );
}

export default DecisionList;
