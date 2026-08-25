import { lazy } from 'react';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { FileAttachmentsProvider } from './features/files/FileAttachmentsContext';
import { WorkbenchPage } from './pages/WorkbenchPage';

const PlaceholderPage = lazy(() =>
  import('./pages/PlaceholderPage').then((module) => ({ default: module.PlaceholderPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
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
                <Route index element={<WorkbenchPage />} />
                <Route path="chat/:conversationId" element={<WorkbenchPage />} />
                <Route path="audio/*" element={<WorkbenchPage />} />
                <Route path="batch" element={<WorkbenchPage />} />
                <Route path="separation" element={<WorkbenchPage />} />
                <Route path="denoise" element={<WorkbenchPage />} />
                <Route path="creative" element={<WorkbenchPage />} />
                <Route path="usb" element={<WorkbenchPage />} />
                <Route path="tasks" element={<TaskCenterPage />} />
                <Route path="settings" element={<SettingsPage />} />
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
