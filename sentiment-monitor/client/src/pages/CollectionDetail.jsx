import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Table, Button, Space, Tag, message, Spin, Modal, Form, Input, Checkbox, Popconfirm } from 'antd';
import { ArrowLeftOutlined, CheckOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';
import { collectionApi, itemsApi } from '../services/api';

function CollectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [collection, setCollection] = useState(null);
  const [items, setItems] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadCollection();
  }, [id]);

  const loadCollection = async () => {
    try {
      setLoading(true);
      const res = await collectionApi.get(id);
      setCollection(res.data);
      setItems(res.data.items || []);
    } catch (error) {
      message.error('加载采集记录失败');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (itemId) => {
    try {
      await itemsApi.approve(itemId);
      message.success('已加入汇总');
      loadCollection();
    } catch (error) {
      message.error('操作失败');
    }
  };

  const handleReject = async (itemId) => {
    try {
      await itemsApi.reject(itemId);
      message.success('已标记为拒绝');
      loadCollection();
    } catch (error) {
      message.error('操作失败');
    }
  };

  const handleBatchApprove = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要操作的项');
      return;
    }
    
    try {
      await itemsApi.batch(selectedRowKeys, 'approve');
      message.success(`已批量通过 ${selectedRowKeys.length} 项`);
      setSelectedRowKeys([]);
      loadCollection();
    } catch (error) {
      message.error('操作失败');
    }
  };

  const handleBatchReject = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要操作的项');
      return;
    }
    
    try {
      await itemsApi.batch(selectedRowKeys, 'reject');
      message.success(`已批量拒绝 ${selectedRowKeys.length} 项`);
      setSelectedRowKeys([]);
      loadCollection();
    } catch (error) {
      message.error('操作失败');
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    form.setFieldsValue({
      title: item.title,
      snippet: item.snippet,
    });
    setEditModalVisible(true);
  };

  const handleEditSubmit = async () => {
    try {
      const values = await form.validateFields();
      await itemsApi.update(editingItem.id, values);
      message.success('更新成功');
      setEditModalVisible(false);
      loadCollection();
    } catch (error) {
      if (error.errorFields) return;
      message.error('更新失败');
    }
  };

  const getStatusTag = (status) => {
    switch (status) {
      case 'approved':
        return <Tag color="green">已通过</Tag>;
      case 'rejected':
        return <Tag color="red">已拒绝</Tag>;
      default:
        return <Tag color="blue">待审核</Tag>;
    }
  };

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (text, record) => (
        <a href={record.url} target="_blank" rel="noopener noreferrer">
          {text}
        </a>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 120,
    },
    {
      title: '来源类型',
      dataIndex: 'source_type',
      key: 'source_type',
      width: 100,
      render: (type) => {
        const colorMap = {
          'rss': 'blue',
          'agent-reach': 'purple',
          'duckduckgo': 'orange',
        };
        const color = colorMap[type] || 'default';
        const textMap = {
          'rss': 'RSS',
          'agent-reach': 'Agent-Reach',
          'duckduckgo': 'DuckDuckGo',
        };
        return <Tag color={color}>{textMap[type] || type || '-'}</Tag>;
      },
    },
    {
      title: '发布时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (text) => {
        if (!text) return '-';
        // 转换为 UTC+8 (北京时间)
        const date = new Date(text);
        const utc8Time = new Date(date.getTime() + 8 * 60 * 60 * 1000);
        return utc8Time.toISOString().replace('T', ' ').substring(0, 19);
      },
    },
    {
      title: '风险',
      dataIndex: 'risk_level',
      key: 'risk_level',
      width: 80,
      render: (level) => {
        const color = level === 'high' ? 'red' : level === 'medium' ? 'orange' : 'green';
        return <Tag color={color}>{level === 'high' ? '高' : level === 'medium' ? '中' : '低'}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => getStatusTag(status),
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          {record.status !== 'approved' && (
            <Button
              type="link"
              size="small"
              icon={<CheckOutlined />}
              onClick={() => handleApprove(record.id)}
              style={{ color: '#52c41a' }}
            >
              通过
            </Button>
          )}
          {record.status !== 'rejected' && (
            <Button
              type="link"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => handleReject(record.id)}
              danger
            >
              拒绝
            </Button>
          )}
        </Space>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!collection) {
    return <div>采集记录不存在</div>;
  }

  return (
    <div>
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate(-1)}
        style={{ marginBottom: '16px', padding: 0 }}
      >
        返回
      </Button>

      <Card>
        <h2>采集任务 #{collection.id}</h2>
        <Space size="large">
          <Tag color={collection.trigger_type === 'manual' ? 'blue' : 'green'}>
            {collection.trigger_type === 'manual' ? '手动' : '定时'}
          </Tag>
          <Tag color={collection.status === 'success' ? 'green' : 'red'}>
            {collection.status === 'success' ? '成功' : '失败'}
          </Tag>
          <span>采集数量: {collection.items_count}</span>
          <span>开始时间: {(() => {
            const date = new Date(collection.started_at + 'Z');
            const utc8Time = new Date(date.getTime() + 8 * 60 * 60 * 1000);
            return utc8Time.toISOString().replace('T', ' ').substring(0, 19);
          })()}</span>
          {collection.completed_at && (
            <span>完成时间: {(() => {
              const date = new Date(collection.completed_at + 'Z');
              const utc8Time = new Date(date.getTime() + 8 * 60 * 60 * 1000);
              return utc8Time.toISOString().replace('T', ' ').substring(0, 19);
            })()}</span>
          )}
        </Space>
      </Card>

      <Card style={{ marginTop: '16px' }}>
        <div style={{ marginBottom: '16px' }}>
          <Space>
            <Button type="primary" onClick={handleBatchApprove} disabled={selectedRowKeys.length === 0}>
              批量通过 ({selectedRowKeys.length})
            </Button>
            <Button danger onClick={handleBatchReject} disabled={selectedRowKeys.length === 0}>
              批量拒绝 ({selectedRowKeys.length})
            </Button>
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={items}
          rowKey="id"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          pagination={{ pageSize: 20 }}
        />
      </Card>

      <Modal
        title="编辑 Item"
        open={editModalVisible}
        onOk={handleEditSubmit}
        onCancel={() => setEditModalVisible(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: '请输入标题' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="snippet"
            label="摘要"
          >
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default CollectionDetail;
