import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Tabs, Table, Tag, Button, message, Spin, Select, Space } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { projectsApi, healthApi, collectionApi } from '../services/api';
import HealthChart from '../components/HealthChart';

function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [healthData, setHealthData] = useState({ sources: [], trend: [] });
  const [collectionHistory, setCollectionHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceTypeFilter, setSourceTypeFilter] = useState(null); // 来源类型筛选

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [projectRes, healthSourcesRes, healthTrendRes] = await Promise.all([
        projectsApi.get(id),
        healthApi.sources(id).catch(() => ({ data: [] })),
        healthApi.trend(id).catch(() => ({ data: [] })),
      ]);

      setProject(projectRes.data);
      setHealthData({
        sources: healthSourcesRes.data,
        trend: healthTrendRes.data,
      });

      loadCollectionHistory();
    } catch (error) {
      message.error('加载项目详情失败');
    } finally {
      setLoading(false);
    }
  };

  const loadCollectionHistory = async () => {
    try {
      const res = await collectionApi.list({ project_id: id, limit: 50 });
      setCollectionHistory(res.data);
    } catch (error) {
      console.error('加载采集历史失败:', error);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!project) {
    return <div>项目不存在</div>;
  }

  const healthColumns = [
    {
      title: '数据源',
      dataIndex: 'source',
      key: 'source',
    },
    {
      title: '来源类型',
      dataIndex: 'source_type',
      key: 'source_type',
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
      title: '链接',
      dataIndex: 'link',
      key: 'link',
      render: (link) => {
        if (!link) return '-';
        return (
          <a href={link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px' }}>
            {link.length > 30 ? link.substring(0, 30) + '...' : link}
          </a>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const color = status === 'normal' ? 'green' : status === 'anomaly' ? 'red' : 'default';
        return <Tag color={color}>{status === 'normal' ? '正常' : status === 'anomaly' ? '异常' : status}</Tag>;
      },
    },
    {
      title: '原始数据',
      dataIndex: 'raw_count',
      key: 'raw_count',
    },
    {
      title: '过滤后',
      dataIndex: 'filtered_count',
      key: 'filtered_count',
    },
    {
      title: '日期',
      dataIndex: 'date',
      key: 'date',
    },
  ];

  const collectionColumns = [
    {
      title: '触发时间',
      dataIndex: 'started_at',
      key: 'started_at',
      render: (text) => {
        if (!text) return '-';
        // 数据库存储的是UTC时间，需要转换为UTC+8
        const date = new Date(text + 'Z');
        const utc8Time = new Date(date.getTime() + 8 * 60 * 60 * 1000);
        return utc8Time.toISOString().replace('T', ' ').substring(0, 19);
      },
    },
    {
      title: '触发类型',
      dataIndex: 'trigger_type',
      key: 'trigger_type',
      render: (type) => (
        <Tag color={type === 'manual' ? 'blue' : 'green'}>
          {type === 'manual' ? '手动' : '定时'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const color = status === 'success' ? 'green' : status === 'error' ? 'red' : 'blue';
        const text = status === 'success' ? '成功' : status === 'error' ? '失败' : '运行中';
        return <Tag color={color}>{text}</Tag>;
      },
    },
    {
      title: '采集数量',
      dataIndex: 'items_count',
      key: 'items_count',
    },
    {
      title: '耗时',
      key: 'duration',
      render: (_, record) => {
        if (!record.completed_at) return '-';
        const start = new Date(record.started_at).getTime();
        const end = new Date(record.completed_at).getTime();
        const duration = Math.round((end - start) / 1000);
        return `${duration}秒`;
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Button type="link" onClick={() => navigate(`/collection/${record.id}`)}>
          查看详情
        </Button>
      ),
    },
  ];

  const tabItems = [
    {
      key: 'health',
      label: '健康度监控',
      children: (
        <div>
          <HealthChart data={healthData.trend} />
          <div style={{ marginTop: '16px', marginBottom: '16px' }}>
            <Space>
              <span>来源类型筛选：</span>
              <Select
                style={{ width: 150 }}
                placeholder="全部类型"
                allowClear
                value={sourceTypeFilter}
                onChange={(value) => setSourceTypeFilter(value)}
              >
                <Select.Option value="rss">RSS</Select.Option>
                <Select.Option value="agent-reach">Agent-Reach</Select.Option>
                <Select.Option value="duckduckgo">DuckDuckGo</Select.Option>
              </Select>
            </Space>
          </div>
          <Table
            columns={healthColumns}
            dataSource={sourceTypeFilter 
              ? healthData.sources.filter(s => s.source_type === sourceTypeFilter)
              : healthData.sources
            }
            rowKey="source"
            pagination={false}
          />
        </div>
      ),
    },
    {
      key: 'history',
      label: '采集历史',
      children: (
        <Table
          columns={collectionColumns}
          dataSource={collectionHistory}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: '暂无采集记录' }}
        />
      ),
    },
    {
      key: 'config',
      label: '项目配置',
      children: (
        <pre style={{ background: '#f5f5f5', padding: '16px', borderRadius: '4px' }}>
          {JSON.stringify(project.config, null, 2)}
        </pre>
      ),
    },
  ];

  return (
    <div>
      <Button
        type="link"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/projects')}
        style={{ marginBottom: '16px', padding: 0 }}
      >
        返回项目列表
      </Button>

      <Card>
        <Descriptions title="项目信息" bordered>
          <Descriptions.Item label="项目名称">{project.name}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={project.enabled ? 'green' : 'default'}>
              {project.enabled ? '启用' : '禁用'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(project.created_at).toLocaleString('zh-CN')}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {new Date(project.updated_at).toLocaleString('zh-CN')}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card style={{ marginTop: '16px' }}>
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
}

export default ProjectDetail;
