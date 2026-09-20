import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Spin, message, Button, Select, Card, Space, Tag, Table } from 'antd';
import { 
  FileTextOutlined, 
  CheckCircleOutlined, 
  WarningOutlined,
  StopOutlined,
  PlayCircleOutlined,
  SyncOutlined
} from '@ant-design/icons';
import StatCard from '../components/StatCard';
import HealthChart from '../components/HealthChart';
import DecisionList from '../components/DecisionList';
import { projectsApi, healthApi, decisionsApi, schedulerApi, collectionApi } from '../services/api';

function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [collectionHistory, setCollectionHistory] = useState([]);
  const [stats, setStats] = useState({
    totalProjects: 0,
    totalItems: 0,
    healthOverview: { normal: 0, anomaly: 0, disabled: 0 },
    decisions: [],
    trend: [],
  });
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      const projectsRes = await projectsApi.list();
      const projectsData = projectsRes.data;
      setProjects(projectsData);
      
      if (projectsData.length === 0) {
        setStats({
          totalProjects: 0,
          totalItems: 0,
          healthOverview: { normal: 0, anomaly: 0, disabled: 0 },
          decisions: [],
          trend: [],
        });
        setCollectionHistory([]);
        return;
      }

      const projectId = projectsData[0].id;
      if (!selectedProject) {
        setSelectedProject(projectId);
      }
      
      const [healthRes, decisionsRes, trendRes, statusRes, collectionRes] = await Promise.all([
        healthApi.overview(projectId).catch(() => ({ data: { normal: 0, anomaly: 0, disabled: 0 } })),
        decisionsApi.list({ limit: 5 }).catch(() => ({ data: [] })),
        healthApi.trend(projectId).catch(() => ({ data: [] })),
        schedulerApi.getStatus().catch(() => ({ data: null })),
        collectionApi.list({ project_id: projectId, limit: 10 }).catch(() => ({ data: [] })),
      ]);

      setStats({
        totalProjects: projectsData.length,
        totalItems: 0,
        healthOverview: healthRes.data,
        decisions: decisionsRes.data,
        trend: trendRes.data,
      });
      
      if (statusRes.data) {
        setSchedulerStatus(statusRes.data);
      }
      
      setCollectionHistory(collectionRes.data || []);
    } catch (error) {
      console.error('加载数据失败:', error);
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleTrigger = async () => {
    if (!selectedProject) {
      message.warning('请先选择项目');
      return;
    }
    
    try {
      setTriggering(true);
      await schedulerApi.trigger(selectedProject);
      message.success('采集任务已启动');
      
      // 延迟刷新状态
      setTimeout(() => {
        loadData();
      }, 2000);
    } catch (error) {
      console.error('触发任务失败:', error);
      message.error(error.response?.data?.error?.message || '触发任务失败');
    } finally {
      setTriggering(false);
    }
  };

  const handleProjectChange = async (projectId) => {
    setSelectedProject(projectId);
    
    try {
      const [healthRes, trendRes, collectionRes] = await Promise.all([
        healthApi.overview(projectId).catch(() => ({ data: { normal: 0, anomaly: 0, disabled: 0 } })),
        healthApi.trend(projectId).catch(() => ({ data: [] })),
        collectionApi.list({ project_id: projectId, limit: 10 }).catch(() => ({ data: [] })),
      ]);
      
      setStats(prev => ({
        ...prev,
        healthOverview: healthRes.data,
        trend: trendRes.data,
      }));
      
      setCollectionHistory(collectionRes.data || []);
    } catch (error) {
      console.error('切换项目失败:', error);
    }
  };

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

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <Card style={{ marginBottom: '16px' }}>
        <Space size="large" wrap>
          <div>
            <span style={{ marginRight: '8px' }}>选择项目：</span>
            <Select
              value={selectedProject}
              onChange={handleProjectChange}
              style={{ width: 200 }}
              placeholder="选择项目"
            >
              {projects.map(p => (
                <Select.Option key={p.id} value={p.id}>{p.name}</Select.Option>
              ))}
            </Select>
          </div>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleTrigger}
            loading={triggering}
            disabled={!selectedProject}
          >
            手动采集
          </Button>
          {schedulerStatus && (
            <div>
              <span style={{ marginRight: '8px' }}>任务状态：</span>
              <Tag color={schedulerStatus.isRunning ? 'processing' : 'default'}>
                {schedulerStatus.isRunning ? '运行中' : '空闲'}
              </Tag>
              {schedulerStatus.lastRunTime && (
                <span style={{ marginLeft: '16px', color: '#666' }}>
                  上次运行: {new Date(schedulerStatus.lastRunTime).toLocaleString('zh-CN')}
                </span>
              )}
            </div>
          )}
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="监控项目"
            value={stats.totalProjects}
            icon={<FileTextOutlined />}
            color="#1890ff"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="正常源"
            value={stats.healthOverview.normal}
            icon={<CheckCircleOutlined />}
            color="#52c41a"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="异常源"
            value={stats.healthOverview.anomaly}
            icon={<WarningOutlined />}
            color="#faad14"
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <StatCard
            title="已禁用源"
            value={stats.healthOverview.disabled}
            icon={<StopOutlined />}
            color="#ff4d4f"
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: '24px' }}>
        <Col xs={24} lg={16}>
          <HealthChart data={stats.trend} />
        </Col>
        <Col xs={24} lg={8}>
          <DecisionList decisions={stats.decisions} onRefresh={loadData} />
        </Col>
      </Row>

      <Card title="采集历史" style={{ marginTop: '24px' }}>
        <Table
          columns={collectionColumns}
          dataSource={collectionHistory}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无采集记录' }}
        />
      </Card>
    </div>
  );
}

export default Dashboard;
