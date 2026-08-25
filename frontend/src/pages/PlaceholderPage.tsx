import { Card, Empty, Typography } from 'antd';

interface PlaceholderPageProps {
  title: string;
  description: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <Card className="placeholder-page" title={<Typography.Text strong>{title}</Typography.Text>}>
      <Empty description={description} />
    </Card>
  );
}
