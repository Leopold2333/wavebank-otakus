import { lazy } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { FileAttachmentsProvider } from './features/files/FileAttachmentsContext';
import { WorkbenchPage } from './pages/WorkbenchPage';

const AgentAccessGate = lazy(() =>
  import('./pages/AgentAccessGate').then((module) => ({ default: module.AgentAccessGate })),
);
const PlaceholderPage = lazy(() =>
  import('./pages/PlaceholderPage').then((module) => ({ default: module.PlaceholderPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
);
const FfmpegSettingsPage = lazy(() =>
  import('./pages/settings/FfmpegSettingsPage').then((module) => ({
    default: module.FfmpegSettingsPage,
  })),
);
const AgentSettingsPage = lazy(() =>
  import('./pages/settings/AgentSettingsPage').then((module) => ({
    default: module.AgentSettingsPage,
  })),
);
const MsstSettingsPage = lazy(() =>
  import('./pages/settings/MsstSettingsPage').then((module) => ({
    default: module.MsstSettingsPage,
  })),
);
const TaskCenterPage = lazy(() =>
  import('./pages/TaskCenterPage').then((module) => ({ default: module.TaskCenterPage })),
);

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
        },
      }}
    >
      <AntdApp>
        <FileAttachmentsProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route index element={<Navigate to="/chat" replace />} />
                <Route
                  path="chat"
                  element={
                    <AgentAccessGate>
                      <WorkbenchPage />
                    </AgentAccessGate>
                  }
                />
                <Route
                  path="chat/:conversationId"
                  element={
                    <AgentAccessGate>
                      <WorkbenchPage />
                    </AgentAccessGate>
                  }
                />
                <Route path="audio/*" element={<WorkbenchPage />} />
                <Route path="batch" element={<WorkbenchPage />} />
                <Route path="separation" element={<WorkbenchPage />} />
                <Route path="denoise" element={<WorkbenchPage />} />
                <Route path="creative" element={<WorkbenchPage />} />
                <Route path="usb" element={<WorkbenchPage />} />
                <Route path="tasks/*" element={<TaskCenterPage />} />
                <Route path="settings" element={<SettingsPage />}>
                  <Route index element={<Navigate to="/settings/ffmpeg" replace />} />
                  <Route path="ffmpeg" element={<FfmpegSettingsPage />} />
                  <Route path="agent" element={<AgentSettingsPage />} />
                  <Route path="msst" element={<MsstSettingsPage />} />
                </Route>
                <Route
                  path="*"
                  element={<PlaceholderPage title="页面建设中" description="该页面尚未实现" />}
                />
              </Route>
            </Routes>
          </BrowserRouter>
        </FileAttachmentsProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
