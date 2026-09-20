import { useEffect, useState } from 'react';
import { Table, Tag, Button, message, Popconfirm, Space } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import { decisionsApi } from '../services/api';

function Decisions() {
  const [decisions, setDecisions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  useEffect(() => {
    loadDecisions();
  }, []);

  const loadDecisions = async (page = 1, pageSize = 20) => {
    try {
      setLoading(true);
      const res = await decisionsApi.list({ page, limit: pageSize });
      setDecisions(res.data);
      setPagination({ current: page, pageSize, total: res.data.length });
    } catch (error) {
      message.error('加载决策记录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async (id) => {
    try {
      await decisionsApi.undo(id);
      message.success('撤销成功');
      loadDecisions(pagination.current, pagination.pageSize);
    } catch (error) {
      message.error('撤销失败');
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

  const columns = [
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      render: (action) => (
        <Tag color={getActionColor(action)}>{getActionText(action)}</Tag>
      ),
    },
    {
      title: '目标',
      dataIndex: 'target',
      key: 'target',
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
    },
    {
      title: '执行时间',
      dataIndex: 'executed_at',
      key: 'executed_at',
      render: (text) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Popconfirm
          title="确定要撤销这个决策吗？"
          onConfirm={() => handleUndo(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="link" icon={<UndoOutlined />}>
            撤销
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <h2>决策记录</h2>
      <Table
        columns={columns}
        dataSource={decisions}
        rowKey="id"
        loading={loading}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        onChange={(pagination) => loadDecisions(pagination.current, pagination.pageSize)}
      />
    </div>
  );
}

export default Decisions;
