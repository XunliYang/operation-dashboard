import { useEffect, useState } from 'react';
import { Layout, Menu, Drawer, Button } from 'antd';
import {
  DashboardOutlined,
  ProjectOutlined,
  HistoryOutlined,
  SettingOutlined,
  FileTextOutlined,
  FileSearchOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { Link, useLocation, Outlet } from 'react-router-dom';
import ChatWidget from './ChatWidget';

const { Header, Sider, Content } = Layout;

/** 窄屏断点：与运营看板 web 壳层 LEOY-27 保持一致，≤767px（<Ant Design `md`）视为移动端。 */
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

/** 订阅移动端媒体查询；无 `matchMedia` 的环境回退为桌面。 */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = (event) => setIsMobile(event.matches);
    setIsMobile(mql.matches);
    // 现代浏览器用 addEventListener；旧版 Safari/WebView 回退到 addListener。
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
    } else if (typeof mql.addListener === 'function') {
      mql.addListener(onChange);
    }
    return () => {
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', onChange);
      } else if (typeof mql.removeListener === 'function') {
        mql.removeListener(onChange);
      }
    };
  }, []);

  return isMobile;
}

function AppLayout() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 回到桌面断点时自动收起抽屉，避免状态残留。
  useEffect(() => {
    if (!isMobile) {
      setDrawerOpen(false);
    }
  }, [isMobile]);

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: <Link to="/">Dashboard</Link> },
    { key: '/projects', icon: <ProjectOutlined />, label: <Link to="/projects">项目管理</Link> },
    { key: '/summary', icon: <FileTextOutlined />, label: <Link to="/summary">采集汇总</Link> },
    { key: '/decisions', icon: <HistoryOutlined />, label: <Link to="/decisions">决策记录</Link> },
    { key: '/logs', icon: <FileSearchOutlined />, label: <Link to="/logs">日志查看</Link> },
    { key: '/config', icon: <SettingOutlined />, label: <Link to="/config">系统配置</Link> },
  ];

  const menu = (
    <Menu
      mode="inline"
      selectedKeys={[location.pathname]}
      items={menuItems}
      onClick={() => setDrawerOpen(false)}
    />
  );

  const brand = (
    <div style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', fontSize: '18px' }}>
      舆情监控
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {isMobile ? (
        <Drawer
          title="舆情监控"
          placement="left"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={220}
          styles={{ body: { padding: 0 } }}
        >
          {menu}
        </Drawer>
      ) : (
        <Sider theme="light" width={200}>
          {brand}
          {menu}
        </Sider>
      )}

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: isMobile ? '0 12px' : '0 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {isMobile && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              onClick={() => setDrawerOpen(true)}
              aria-label="打开菜单"
            />
          )}
          <h2
            style={{
              margin: 0,
              fontSize: isMobile ? '16px' : '20px',
              whiteSpace: 'nowrap',
            }}
          >
            Sentiment Monitor
          </h2>
        </Header>
        <Content
          style={{
            margin: isMobile ? '12px 8px' : '24px 16px',
            padding: isMobile ? 16 : 24,
            background: '#fff',
            borderRadius: 8,
            minHeight: 280,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
      <ChatWidget />
    </Layout>
  );
}

export default AppLayout;
