import { useState, useRef, useEffect } from 'react';
import { FloatButton, Card, Input, Button, Empty, Tag, message } from 'antd';
import { MessageOutlined, SendOutlined, CloseOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { aiApi } from '../services/api';

function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading, status]);

  const updateLastAssistant = (updater) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === 'assistant') {
        next[next.length - 1] = updater(last);
      }
      return next;
    });
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;

    const history = [...messages, { role: 'user', content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setLoading(true);
    setStatus('');

    aiApi.chatStream(history, {
      onStatus: (t) => setStatus(t),
      onToken: (delta) => {
        updateLastAssistant((last) => ({ ...last, content: last.content + delta }));
        setStatus('');
      },
      onDone: (content) => {
        updateLastAssistant((last) => (last.content ? last : { ...last, content: content || last.content }));
        setLoading(false);
        setStatus('');
      },
      onError: (err) => {
        updateLastAssistant((last) => ({
          ...last,
          content: last.content || `⚠️ ${err.message}`,
        }));
        message.error(err.message || '请求失败，请稍后重试');
        setLoading(false);
        setStatus('');
      },
    });
  };

  return (
    <>
      <FloatButton
        type="primary"
        icon={open ? <CloseOutlined /> : <MessageOutlined />}
        onClick={() => setOpen(!open)}
        style={{ right: 24, bottom: 24 }}
      />
      {open && (
        <Card
          title="AI 助手"
          size="small"
          style={{
            position: 'fixed',
            right: 24,
            bottom: 80,
            width: 380,
            height: 520,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000,
          }}
          styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 } }}
        >
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {messages.length === 0 && (
              <Empty
                description="问我任何关于配置、站点、项目的问题"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: '12px',
                }}
              >
                {m.role === 'assistant' && <RobotOutlined style={{ marginRight: 8, color: '#1677ff' }} />}
                <div
                  style={{
                    maxWidth: '80%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: m.role === 'user' ? '#1677ff' : '#f0f0f0',
                    color: m.role === 'user' ? '#fff' : '#000',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    minHeight: m.role === 'assistant' && !m.content ? 20 : undefined,
                  }}
                >
                  {m.content}
                  {m.role === 'assistant' && loading && i === messages.length - 1 && !m.content && '…'}
                </div>
                {m.role === 'user' && <UserOutlined style={{ marginLeft: 8, color: '#1677ff' }} />}
              </div>
            ))}
            {status && (
              <div style={{ marginBottom: '12px' }}>
                <Tag color="processing">{status}</Tag>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', padding: '12px', borderTop: '1px solid #f0f0f0' }}>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={handleSend}
              placeholder="例如：给项目 1 添加知乎站点"
              disabled={loading}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSend}
              loading={loading}
              style={{ marginLeft: 8 }}
            />
          </div>
        </Card>
      )}
    </>
  );
}

export default ChatWidget;
