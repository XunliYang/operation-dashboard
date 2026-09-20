import { useEffect, useState } from 'react';
import { Card, Table, Button, Space, Tag, message, Popconfirm, Select } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { itemsApi, projectsApi } from '../services/api';

function Summary() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (projects.length > 0) {
      loadSummary();
    }
  }, [projects, selectedProject]);

  const loadProjects = async () => {
    try {
      const res = await projectsApi.list();
      setProjects(res.data);
      if (res.data.length > 0 && !selectedProject) {
        setSelectedProject(res.data[0].id);
      }
    } catch (error) {
      message.error('加载项目列表失败');
    }
  };

  const loadSummary = async () => {
    try {
      setLoading(true);
      const params = selectedProject ? { project_id: selectedProject } : {};
      const res = await itemsApi.getSummary(params);
      setItems(res.data);
    } catch (error) {
      message.error('加载汇总数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveFromSummary = async (itemId) => {
    try {
      await itemsApi.removeFromSummary(itemId);
      message.success('已从汇总中移除');
      loadSummary();
    } catch (error) {
      message.error('操作失败');
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
      title: '采集时间',
      dataIndex: 'collection_time',
      key: 'collection_time',
      width: 180,
      render: (text) => text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Popconfirm
          title="确定要从汇总中移除吗？"
          onConfirm={() => handleRemoveFromSummary(record.id)}
          okText="确定"
          cancelText="取消"
        >
          <Button type="link" danger icon={<DeleteOutlined />}>
            移除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>采集汇总</h2>
        <Space>
          <span>选择项目：</span>
          <Select
            value={selectedProject}
            onChange={setSelectedProject}
            style={{ width: 200 }}
            placeholder="选择项目"
          >
            {projects.map(p => (
              <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>
            ))}
          </Select>
        </Space>
      </div>

      <Card>
        <Table
          columns={columns}
          dataSource={items}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
        />
      </Card>
    </div>
  );
}

export default Summary;
