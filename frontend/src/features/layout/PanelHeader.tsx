import type { ReactNode } from 'react';
import { Space, Typography } from 'antd';

export function PanelHeader({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="panel-header">
      <Space size={8}>
        {icon}
        <Typography.Text strong>{children}</Typography.Text>
      </Space>
    </div>
  );
}
