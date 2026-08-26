import { Suspense, useMemo, useState } from 'react';
import { Button, Layout, Menu, Spin, Typography } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  SettingOutlined,
  SoundOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AUDIO_SUBTYPES } from '../features/params/audioSubtypes';
import { INTENT_DEFINITIONS } from '../features/params/intentRegistry';

const { Content, Header, Sider } = Layout;

const INTENT_MENU_IDS = ['audio', 'batch', 'separation', 'denoise', 'creative', 'usb'] as const;

const NON_INTENT_MENU_ITEMS = [
  { key: 'agent', icon: <RobotOutlined />, label: 'Agent 工作台' },
  { key: 'settings', icon: <SettingOutlined />, label: '设置' },
] as const;

const TASK_CENTER_MENU_ITEM = {
  key: 'tasks',
  icon: <UnorderedListOutlined />,
  label: '任务中心',
  children: [
    { key: 'tasks/pipeline', label: 'Pipeline 任务' },
    { key: 'tasks/operations', label: '单操作任务' },
  ],
} as const;

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const menuItems = useMemo(
    () => [
      ...NON_INTENT_MENU_ITEMS.slice(0, 1),
      ...INTENT_MENU_IDS.map((id) => {
        const definition = INTENT_DEFINITIONS.find((item) => item.id === id);
        if (!definition) {
          return null;
        }
        if (id === 'audio') {
          return {
            key: 'audio',
            icon: definition.icon,
            label: definition.label,
            children: AUDIO_SUBTYPES.map((subtype) => ({
              key: `audio/${subtype.id}`,
              label: subtype.label,
            })),
          };
        }
        return {
          key: definition.id,
          icon: definition.icon,
          label: definition.label,
        };
      }).filter((item): item is NonNullable<typeof item> => item !== null),
      { type: 'divider' as const },
      TASK_CENTER_MENU_ITEM,
      ...NON_INTENT_MENU_ITEMS.slice(1),
    ],
    [],
  );

  const selectedKey =
    pathname === '/' || pathname === '/chat' || pathname.startsWith('/chat/')
      ? 'agent'
      : pathname.startsWith('/audio/')
        ? pathname.slice(1)
        : pathname === '/tasks' || pathname.startsWith('/tasks/')
          ? pathname === '/tasks'
            ? 'tasks/pipeline'
            : pathname.slice(1)
        : pathname.split('/')[1] || 'agent';
  const titleKey = selectedKey.startsWith('audio/')
    ? 'audio'
    : selectedKey.startsWith('tasks/')
      ? 'tasks'
      : selectedKey;
  const intentTitle = INTENT_DEFINITIONS.find((item) => item.id === titleKey)?.label;
  const staticTitle = [...NON_INTENT_MENU_ITEMS, TASK_CENTER_MENU_ITEM].find(
    (item) => item.key === titleKey,
  )?.label;
  const currentTitle = intentTitle ?? staticTitle ?? 'WaveBank Otakus';

  return (
    <Layout className="app-layout">
      <Sider
        className="app-sider"
        width={232}
        collapsedWidth={64}
        collapsed={collapsed}
        trigger={null}
        collapsible
        theme="light"
      >
        <div className={`app-brand${collapsed ? ' app-brand--collapsed' : ''}`}>
          <SoundOutlined className="app-brand__icon" />
          <div className="app-brand__text">
            <div className="app-brand__name">WaveBank Otakus</div>
            <div className="app-brand__subtitle">音波库</div>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={['audio', 'tasks']}
          items={menuItems}
          onClick={({ key }) => navigate(key === 'agent' ? '/chat' : `/${key}`)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>

      <Layout>
        <Header className="app-header">
          <Button
            type="text"
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
          />
          <Typography.Text strong>{currentTitle}</Typography.Text>
        </Header>
        <Content className="app-content">
          <Suspense
            fallback={
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 320,
                }}
              >
                <Spin description="正在加载…" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}
