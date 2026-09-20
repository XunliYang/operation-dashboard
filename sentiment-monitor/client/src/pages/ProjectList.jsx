import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, message, Popconfirm, Switch, Tabs, Select, Radio, Card } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { projectsApi } from '../services/api';

// 定时任务预设选项
const SCHEDULE_PRESETS = {
  daily: [
    { value: '0 6 * * *', label: '每天 6:00' },
    { value: '0 8 * * *', label: '每天 8:00（推荐）' },
    { value: '0 10 * * *', label: '每天 10:00' },
    { value: '0 12 * * *', label: '每天 12:00' },
    { value: '0 18 * * *', label: '每天 18:00' },
    { value: '0 20 * * *', label: '每天 20:00' },
    { value: 'custom', label: '自定义...' },
  ],
  healthCheck: [
    { value: '*/15 * * * *', label: '每 15 分钟' },
    { value: '*/30 * * * *', label: '每 30 分钟' },
    { value: '0 * * * *', label: '每小时（推荐）' },
    { value: '0 */2 * * *', label: '每 2 小时' },
    { value: '0 */6 * * *', label: '每 6 小时' },
    { value: 'custom', label: '自定义...' },
  ],
};

// 默认配置模板
const DEFAULT_CONFIG = {
  keywords: [],
  keywordConfig: {
    daysBack: 3,
    todayOnly: false
  },
  rssSources: [],
  schedule: {
    dailyCron: '0 8 * * *',
    healthCheckCron: '0 * * * *'
  },
  email: {
    enabled: false,
    smtp: {
      host: '',
      port: 465,
      secure: true,
      auth: {
        user: '',
        pass: ''
      }
    },
    to: [],
    productionTo: [],
    productionCc: []
  }
};

function ProjectList() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [form] = Form.useForm();
  
  // 定时任务预设选项状态
  const [dailyPreset, setDailyPreset] = useState('0 8 * * *');
  const [healthPreset, setHealthPreset] = useState('0 * * * *');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const res = await projectsApi.list();
      setProjects(res.data);
    } catch (error) {
      message.error('加载项目列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingProject(null);
    form.resetFields();
    form.setFieldsValue(DEFAULT_CONFIG);
    // 重置预设选项状态
    setDailyPreset('0 8 * * *');
    setHealthPreset('0 * * * *');
    setModalVisible(true);
  };

  const handleEdit = (project) => {
    setEditingProject(project);
    // 先重置表单
    form.resetFields();
    // 将嵌套的 config 展平到表单
    const config = project.config || {};
    form.setFieldsValue({
      name: project.name,
      keywords: config.keywords || [],
      daysBack: config.keywordConfig?.daysBack || 3,
      todayOnly: config.keywordConfig?.todayOnly || false,
      rssSources: config.rssSources || [],
      dailyCron: config.schedule?.dailyCron || '0 8 * * *',
      healthCheckCron: config.schedule?.healthCheckCron || '0 * * * *',
      emailEnabled: config.email?.enabled || false,
      smtpHost: config.email?.smtp?.host || '',
      smtpPort: config.email?.smtp?.port || 465,
      smtpSecure: config.email?.smtp?.secure ?? true,
      smtpUser: config.email?.smtp?.auth?.user || '',
      smtpPass: config.email?.smtp?.auth?.pass || '',
      emailTo: config.email?.to || [],
      productionTo: config.email?.productionTo || [],
      productionCc: config.email?.productionCc || [],
    });
    
    // 设置预设选项状态
    const dailyCron = config.schedule?.dailyCron || '0 8 * * *';
    const healthCron = config.schedule?.healthCheckCron || '0 * * * *';
    const dailyMatch = SCHEDULE_PRESETS.daily.find(p => p.value === dailyCron);
    const healthMatch = SCHEDULE_PRESETS.healthCheck.find(p => p.value === healthCron);
    setDailyPreset(dailyMatch ? dailyCron : 'custom');
    setHealthPreset(healthMatch ? healthCron : 'custom');
    
    setModalVisible(true);
  };

  const handleDelete = async (id) => {
    try {
      await projectsApi.delete(id);
      message.success('删除成功');
      loadProjects();
    } catch (error) {
      message.error('删除失败');
    }
  };

  const handleToggleEnabled = async (project) => {
    try {
      if (project.enabled) {
        await projectsApi.disable(project.id);
        message.success('已禁用');
      } else {
        await projectsApi.enable(project.id);
        message.success('已启用');
      }
      loadProjects();
    } catch (error) {
      message.error('操作失败');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      // 构建配置对象
      const config = {
        keywords: values.keywords || [],
        keywordConfig: {
          daysBack: values.daysBack || 3,
          todayOnly: values.todayOnly || false
        },
        rssSources: values.rssSources || [],
        schedule: {
          dailyCron: values.dailyCron || '0 8 * * *',
          healthCheckCron: values.healthCheckCron || '0 * * * *'
        },
        email: {
          enabled: values.emailEnabled || false,
          smtp: {
            host: values.smtpHost || '',
            port: values.smtpPort || 465,
            secure: values.smtpSecure ?? true,
            auth: {
              user: values.smtpUser || '',
              pass: values.smtpPass || ''
            }
          },
          to: values.emailTo || [],
          productionTo: values.productionTo || [],
          productionCc: values.productionCc || []
        }
      };
      
      if (editingProject) {
        await projectsApi.update(editingProject.id, { name: values.name, config });
        message.success('更新成功');
      } else {
        await projectsApi.create({ name: values.name, config });
        message.success('创建成功');
      }
      
      setModalVisible(false);
      loadProjects();
    } catch (error) {
      if (error.errorFields) {
        return; // Form validation error
      }
      message.error(error.response?.data?.error?.message || '操作失败');
    }
  };

  const handleDailyPresetChange = (value) => {
    setDailyPreset(value);
    if (value !== 'custom') {
      form.setFieldsValue({ dailyCron: value });
    }
  };

  const handleHealthPresetChange = (value) => {
    setHealthPreset(value);
    if (value !== 'custom') {
      form.setFieldsValue({ healthCheckCron: value });
    }
  };

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      render: (text, record) => (
        <a onClick={() => navigate(`/projects/${record.id}`)}>{text}</a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled, record) => (
        <Switch
          checked={enabled === 1}
          onChange={() => handleToggleEnabled(record)}
          checkedChildren="启用"
          unCheckedChildren="禁用"
        />
      ),
    },
    {
      title: '关键词',
      key: 'keywords',
      render: (_, record) => {
        const keywords = record.config?.keywords || [];
        return (
          <Space>
            {keywords.map((kw) => (
              <Tag key={kw} color="blue">{kw}</Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (text) => new Date(text).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定要删除这个项目吗？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const tabItems = [
    {
      key: 'basic',
      label: '基本信息',
      children: (
        <>
          <Form.Item
            name="name"
            label="项目名称"
            rules={[{ required: true, message: '请输入项目名称' }]}
          >
            <Input placeholder="例如：OpenAN 监控" />
          </Form.Item>
          <Form.Item
            name="keywords"
            label="监控关键词"
            rules={[{ required: true, message: '请至少输入一个关键词' }]}
          >
            <Select
              mode="tags"
              placeholder="输入关键词后按回车添加"
              tokenSeparators={[',']}
            />
          </Form.Item>
          <Form.Item
            name="daysBack"
            label="回溯天数"
            rules={[{ required: true, message: '请输入回溯天数' }]}
          >
            <InputNumber min={1} max={365} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="todayOnly"
            label="仅采集今天的数据"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </>
      ),
    },
    {
      key: 'rss',
      label: 'RSS 源',
      children: (
        <>
          <Form.List name="rssSources">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item
                      {...restField}
                      name={name}
                      rules={[{ required: true, message: '请输入 RSS 源 URL' }]}
                    >
                      <Input placeholder="https://example.com/rss" style={{ width: 400 }} />
                    </Form.Item>
                    <MinusCircleOutlined onClick={() => remove(name)} />
                  </Space>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    添加 RSS 源
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
          <div style={{ color: '#666', fontSize: '12px' }}>
            提示：URL 中可以使用 {'{keyword}'} 作为占位符，采集时会自动替换为关键词
          </div>
        </>
      ),
    },
    {
      key: 'schedule',
      label: '定时任务',
      children: (
        <>
          <Card title="每日采集任务" style={{ marginBottom: '16px' }}>
            <Form.Item label="采集时间">
              <Radio.Group
                value={dailyPreset}
                onChange={(e) => handleDailyPresetChange(e.target.value)}
                style={{ marginBottom: '12px' }}
              >
                {SCHEDULE_PRESETS.daily.map(preset => (
                  <Radio.Button key={preset.value} value={preset.value} style={{ marginBottom: '8px' }}>
                    {preset.label}
                  </Radio.Button>
                ))}
              </Radio.Group>
            </Form.Item>
            <Form.Item
              name="dailyCron"
              label={dailyPreset === 'custom' ? '自定义 Cron 表达式' : '当前配置'}
              rules={[
                { required: true, message: '请输入 cron 表达式' },
                { pattern: /^(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)$/, message: '无效的 cron 表达式格式' }
              ]}
            >
              <Input 
                placeholder="0 8 * * *" 
                disabled={dailyPreset !== 'custom'}
                style={{ opacity: dailyPreset === 'custom' ? 1 : 0.6 }}
              />
            </Form.Item>
            <div style={{ color: '#666', fontSize: '12px' }}>
              Cron 格式: 分 时 日 月 周。例如: '0 8 * * *' 表示每天 8:00
            </div>
          </Card>

          <Card title="健康度检查任务">
            <Form.Item label="检查频率">
              <Radio.Group
                value={healthPreset}
                onChange={(e) => handleHealthPresetChange(e.target.value)}
                style={{ marginBottom: '12px' }}
              >
                {SCHEDULE_PRESETS.healthCheck.map(preset => (
                  <Radio.Button key={preset.value} value={preset.value} style={{ marginBottom: '8px' }}>
                    {preset.label}
                  </Radio.Button>
                ))}
              </Radio.Group>
            </Form.Item>
            <Form.Item
              name="healthCheckCron"
              label={healthPreset === 'custom' ? '自定义 Cron 表达式' : '当前配置'}
              rules={[
                { required: true, message: '请输入 cron 表达式' },
                { pattern: /^(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)\s+(\*|[0-9,\-\/\*]+)$/, message: '无效的 cron 表达式格式' }
              ]}
            >
              <Input 
                placeholder="0 * * * *" 
                disabled={healthPreset !== 'custom'}
                style={{ opacity: healthPreset === 'custom' ? 1 : 0.6 }}
              />
            </Form.Item>
            <div style={{ color: '#666', fontSize: '12px' }}>
              Cron 格式: 分 时 日 月 周。例如: '0 * * * *' 表示每小时
            </div>
          </Card>
        </>
      ),
    },
    {
      key: 'email',
      label: '邮件通知',
      children: (
        <>
          <Form.Item
            name="emailEnabled"
            label="启用邮件通知"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="smtpHost"
            label="SMTP 服务器"
          >
            <Input placeholder="smtp.example.com" />
          </Form.Item>
          <Form.Item
            name="smtpPort"
            label="端口"
          >
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="smtpSecure"
            label="使用 SSL/TLS"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="smtpUser"
            label="用户名"
          >
            <Input placeholder="your-email@example.com" />
          </Form.Item>
          <Form.Item
            name="smtpPass"
            label="密码"
          >
            <Input.Password placeholder="your-password" />
          </Form.Item>
          <Form.Item
            name="emailTo"
            label="测试收件人"
          >
            <Select
              mode="tags"
              placeholder="输入邮箱后按回车添加"
              tokenSeparators={[',']}
            />
          </Form.Item>
          <Form.Item
            name="productionTo"
            label="正式收件人"
          >
            <Select
              mode="tags"
              placeholder="输入邮箱后按回车添加"
              tokenSeparators={[',']}
            />
          </Form.Item>
          <Form.Item
            name="productionCc"
            label="正式抄送"
          >
            <Select
              mode="tags"
              placeholder="输入邮箱后按回车添加"
              tokenSeparators={[',']}
            />
          </Form.Item>
        </>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
        <h2>项目管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          新建项目
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={projects}
        rowKey="id"
        loading={loading}
      />

      <Modal
        title={editingProject ? '编辑项目' : '新建项目'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Tabs items={tabItems} />
        </Form>
      </Modal>
    </div>
  );
}

export default ProjectList;
