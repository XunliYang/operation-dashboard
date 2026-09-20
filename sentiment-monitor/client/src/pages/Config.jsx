import { useEffect, useState } from 'react';
import { Card, Tabs, Form, Input, Button, Switch, message, Spin, Space } from 'antd';
import { configApi } from '../services/api';

function Config() {
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [rulesForm] = Form.useForm();
  const [llmForm] = Form.useForm();

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      setLoading(true);
      const [rulesRes, llmRes] = await Promise.all([
        configApi.getRules(),
        configApi.getLlm(),
      ]);

      rulesForm.setFieldsValue(rulesRes.data);
      llmForm.setFieldsValue(llmRes.data);
    } catch (error) {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRules = async () => {
    try {
      const values = await rulesForm.validateFields();
      await configApi.updateRules(values);
      message.success('决策规则已保存');
    } catch (error) {
      message.error('保存失败');
    }
  };

  const handleSaveLlm = async () => {
    try {
      const values = await llmForm.validateFields();
      await configApi.updateLlm(values);
      message.success('LLM 配置已保存');
    } catch (error) {
      message.error('保存失败');
    }
  };

  const handleTestLlm = async () => {
    let loadingMessage = null;
    try {
      const values = await llmForm.validateFields();
      
      // 如果 API Key 是掩码形式，从数据库获取真实值
      let apiKey = values.apiKey;
      if (apiKey.startsWith('***')) {
        message.warning('请先输入完整的 API Key 再测试');
        return;
      }
      
      setTesting(true);
      loadingMessage = message.loading('正在测试连接...', 0);
      
      const response = await configApi.testLlm({
        apiKey: values.apiKey,
        baseUrl: values.baseUrl,
        model: values.model
      });
      
      if (loadingMessage) loadingMessage();
      
      if (response.data.success) {
        message.success(`连接成功！模型响应: ${response.data.response}`);
      } else {
        message.error(`连接失败: ${response.data.error?.detail || '未知错误'}`);
      }
    } catch (error) {
      if (loadingMessage) loadingMessage();
      
      if (error.response) {
        message.error(`测试失败: ${error.response.data.error?.detail || error.response.data.error?.message || '未知错误'}`);
      } else if (error.errorFields) {
        // 表单验证错误，不显示消息
      } else {
        message.error('测试异常');
      }
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <Spin size="large" />
      </div>
    );
  }

  const tabItems = [
    {
      key: 'rules',
      label: '决策规则',
      children: (
        <Form form={rulesForm} layout="vertical">
          <Card title="数据源健康度" style={{ marginBottom: '16px' }}>
            <Form.Item
              name={['sourceHealth', 'disableAfterDays']}
              label="连续异常天数后禁用"
              rules={[{ required: true, message: '请输入天数' }]}
            >
              <Input type="number" min="1" placeholder="例如：3" />
            </Form.Item>
            <Form.Item
              name={['sourceHealth', 'threshold']}
              label="异常阈值（低于均值的比例）"
              rules={[{ required: true, message: '请输入阈值' }]}
            >
              <Input type="number" min="0" max="1" step="0.1" placeholder="例如：0.5" />
            </Form.Item>
            <Form.Item
              name={['sourceHealth', 'notifyOnDisable']}
              label="禁用时发送邮件通知"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Card>

          <Card title="内容质量">
            <Form.Item
              name={['contentQuality', 'highVolumeThreshold']}
              label="数据量异常阈值"
              rules={[{ required: true, message: '请输入阈值' }]}
            >
              <Input type="number" min="1" placeholder="例如：200" />
            </Form.Item>
          </Card>

          <Button type="primary" onClick={handleSaveRules} style={{ marginTop: '16px' }}>
            保存决策规则
          </Button>
        </Form>
      ),
    },
    {
      key: 'llm',
      label: 'LLM 配置',
      children: (
        <Form form={llmForm} layout="vertical">
          <Form.Item
            name="enabled"
            label="启用 LLM"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true, message: '请输入 Base URL' }]}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            name="model"
            label="模型"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input placeholder="gpt-3.5-turbo" />
          </Form.Item>

          <Space>
            <Button type="primary" onClick={handleSaveLlm}>
              保存 LLM 配置
            </Button>
            <Button onClick={handleTestLlm} loading={testing}>
              测试连接
            </Button>
          </Space>
        </Form>
      ),
    },
  ];

  return (
    <div>
      <h2>系统配置</h2>
      <Card>
        <Tabs items={tabItems} />
      </Card>
    </div>
  );
}

export default Config;
