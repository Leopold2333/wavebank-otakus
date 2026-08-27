import { Tabs } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const SETTINGS_TABS = [
  { key: 'ffmpeg', label: 'ffmpeg 设置' },
  { key: 'agent', label: 'Agent Key' },
  { key: 'msst', label: 'MSST 模型库' },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]['key'];

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathKey = location.pathname.replace(/^\/settings\/?/, '') || 'ffmpeg';
  const activeKey = SETTINGS_TABS.some((tab) => tab.key === pathKey)
    ? (pathKey as SettingsTab)
    : 'ffmpeg';

  return (
    <div className="settings-page">
      <Tabs
        activeKey={activeKey}
        items={[...SETTINGS_TABS]}
        onChange={(key) => navigate(`/settings/${key}`)}
      />
      <Outlet />
    </div>
  );
}
