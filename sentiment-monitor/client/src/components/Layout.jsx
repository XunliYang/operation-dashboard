import { Layout, Menu } from 'antd';
import { 
  DashboardOutlined, 
  ProjectOutlined, 
  HistoryOutlined,
  SettingOutlined,
  FileTextOutlined,
  FileSearchOutlined
} from '@ant-design/icons';
import { Link, useLocation, Outlet } from 'react-router-dom';
import ChatWidget from './ChatWidget';

const { Header, Sider, Content } = Layout;

function AppLayout() {
  const location = useLocation();

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: <Link to="/">Dashboard</Link> },
    { key: '/projects', icon: <ProjectOutlined />, label: <Link to="/projects">项目管理</Link> },
    { key: '/summary', icon: <FileTextOutlined />, label: <Link to="/summary">采集汇总</Link> },
    { key: '/decisions', icon: <HistoryOutlined />, label: <Link to="/decisions">决策记录</Link> },
    { key: '/logs', icon: <FileSearchOutlined />, label: <Link to="/logs">日志查看</Link> },
    { key: '/config', icon: <SettingOutlined />, label: <Link to="/config">系统配置</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="light">
        <div style={{ padding: '16px', textAlign: 'center', fontWeight: 'bold', fontSize: '18px' }}>
          舆情监控
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>Sentiment Monitor</h2>
        </Header>
        <Content style={{ margin: '24px 16px', padding: 24, background: '#fff', borderRadius: 8, minHeight: 280 }}>
          <Outlet />
        </Content>
      </Layout>
      <ChatWidget />
    </Layout>
  );
}

export default AppLayout;
