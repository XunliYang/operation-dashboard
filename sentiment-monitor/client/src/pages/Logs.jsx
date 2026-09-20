import { useEffect, useState } from 'react';
import { Card, Select, Input, Button, Space, Tag, message, Spin, Popconfirm } from 'antd';
import { ReloadOutlined, ClearOutlined } from '@ant-design/icons';
import { logsApi } from '../services/api';

function Logs() {
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [logContent, setLogContent] = useState([]);
  const [totalLines, setTotalLines] = useState(0);
  const [lines, setLines] = useState(100);
  const [search, setSearch] = useState('');
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    loadFiles();
  }, []);

  useEffect(() => {
    if (selectedFile) {
      loadLogContent();
    }
  }, [selectedFile, lines, search]);

  const loadFiles = async () => {
    try {
      setLoading(true);
      const res = await logsApi.getFiles();
      setFiles(res.data);
      if (res.data.length > 0 && !selectedFile) {
        setSelectedFile(res.data[0].name);
      }
    } catch (error) {
      message.error('加载日志文件列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadLogContent = async () => {
    if (!selectedFile) return;
    
    try {
      setContentLoading(true);
      const res = await logsApi.getContent(selectedFile, { lines, search });
      setLogContent(res.data.lines);
      setTotalLines(res.data.totalLines);
    } catch (error) {
      message.error('加载日志内容失败');
    } finally {
      setContentLoading(false);
    }
  };

  const handleClearLog = async () => {
    if (!selectedFile) return;
    
    try {
      await logsApi.clear(selectedFile);
      message.success('日志文件已清空');
      loadLogContent();
      loadFiles();
    } catch (error) {
      message.error('清空日志失败');
    }
  };

  const getLogLevel = (line) => {
    try {
      const logObj = JSON.parse(line);
      return logObj.level || 'info';
    } catch {
      if (line.includes('ERROR')) return 'error';
      if (line.includes('WARN')) return 'warn';
      return 'info';
    }
  };

  const getLevelColor = (level) => {
    switch (level) {
      case 'error': return 'red';
      case 'warn': return 'orange';
      case 'info': return 'blue';
      default: return 'default';
    }
  };

  const formatLogLine = (line) => {
    try {
      const logObj = JSON.parse(line);
      const timestamp = logObj.timestamp ? new Date(logObj.timestamp).toLocaleString('zh-CN') : '';
      const level = logObj.level || 'info';
      const msg = logObj.message || '';
      const service = logObj.service || '';
      
      return {
        timestamp,
        level,
        message: msg,
        service,
        raw: line,
      };
    } catch {
      return {
        timestamp: '',
        level: 'info',
        message: line,
        service: '',
        raw: line,
      };
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>日志查看</h2>
        <Space>
          <Select
            value={selectedFile}
            onChange={setSelectedFile}
            style={{ width: 250 }}
            placeholder="选择日志文件"
          >
            {files.map(file => (
              <Select.Option key={file.name} value={file.name}>
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </Select.Option>
            ))}
          </Select>
          <Button icon={<ReloadOutlined />} onClick={loadLogContent}>
            刷新
          </Button>
          <Popconfirm
            title="确定要清空这个日志文件吗？"
            onConfirm={handleClearLog}
            okText="确定"
            cancelText="取消"
          >
            <Button danger icon={<ClearOutlined />}>
              清空日志
            </Button>
          </Popconfirm>
        </Space>
      </div>

      <Card>
        <Space style={{ marginBottom: '16px' }}>
          <span>显示行数：</span>
          <Select
            value={lines}
            onChange={setLines}
            style={{ width: 100 }}
          >
            <Select.Option value={50}>50</Select.Option>
            <Select.Option value={100}>100</Select.Option>
            <Select.Option value={200}>200</Select.Option>
            <Select.Option value={500}>500</Select.Option>
          </Select>
          <span style={{ marginLeft: '16px' }}>搜索：</span>
          <Input
            placeholder="输入关键词搜索"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Tag color="blue">共 {totalLines} 条日志</Tag>
        </Space>

        {contentLoading ? (
          <div style={{ textAlign: 'center', padding: '50px' }}>
            <Spin />
          </div>
        ) : (
          <div style={{
            background: '#1e1e1e',
            borderRadius: '4px',
            padding: '16px',
            maxHeight: '600px',
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: '12px',
          }}>
            {logContent.length === 0 ? (
              <div style={{ color: '#888', textAlign: 'center', padding: '20px' }}>
                暂无日志
              </div>
            ) : (
              logContent.map((line, index) => {
                const formatted = formatLogLine(line);
                return (
                  <div key={index} style={{ marginBottom: '4px', display: 'flex', alignItems: 'flex-start' }}>
                    <Tag color={getLevelColor(formatted.level)} style={{ marginRight: '8px', minWidth: '50px' }}>
                      {formatted.level}
                    </Tag>
                    <span style={{ color: '#888', marginRight: '8px' }}>{formatted.timestamp}</span>
                    <span style={{ color: '#d4d4d4' }}>{formatted.message}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

export default Logs;
